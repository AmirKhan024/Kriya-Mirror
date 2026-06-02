/**
 * LateralRaiseEngine — bilateral rep tracker for front-camera lateral raise.
 *
 * Mirrors BicepCurlEngine's 4-state machine renamed for shoulder abduction:
 *   DOWN (avg abd ≤ 18°) → RISING (avg abd > 25°) → AT_TOP (stable for 8+
 *   frames at low delta) → LOWERING (abd dropping by DESCENT_FROM_PEAK_DEG or
 *   3°+ per frame) → DOWN (avg abd < 18°, rep complete).
 *
 * Tracks BOTH arms — the average of left + right abduction drives the state
 * machine. Bilateral symmetry gate rejects reps where one arm dramatically
 * lags the other (arm-asymmetry).
 *
 * Posture warnings:
 *   - `torso-swing`     — shoulder-mid X oscillates > 0.04 from baseline (momentum cheat)
 *   - `arm-asymmetry`   — L vs R peak abduction differs by > 15° at rep complete
 *   - `incomplete-raise`— rep complete but peak avg abduction < MIN_REP_PEAK_DEG (75°)
 *   - `malformed-rep`   — ballistic / too-fast
 *   - `not-moving`      — 5s idle in DOWN
 *   - `position-lost`   — no usable frame for ≥ 3s post-cal (Fix N)
 */
import type { PoseLandmarks } from '@/modules/pose/types';
import type { WarningType } from '@/store/workout';
import { LM, lmVisible, shoulderAbductionDeg } from './geometry';
import { LateralRaiseCalibration } from './calibration';
import type {
  LateralRaiseBaseline, LateralRaiseEngineCallbacks, LateralRaiseFrameMetrics, LateralRaiseRepState,
} from './types';
import { computeMQS, getCompletionScore, getFormScore, getSmoothnessScore } from './scoring';
import { debugLog } from '@/lib/debug';

const EMA_ALPHA_ABDUCTION = 0.15;
const ASCEND_START_DEG = 25;
const TOP_STABILITY_FRAMES = 8;
const TOP_STABILITY_DELTA = 3;
const DESCENDING_DELTA_MIN = 3;
const DESCENT_FROM_PEAK_DEG = 10;
const DOWN_THRESHOLD_DEG = 18;
const MIN_REP_PEAK_DEG = 75;        // raise must reach ≥75° avg abduction (arms ~at shoulder height)
// 2026-05-28 round 19: above this peak = arms went OVERHEAD (shoulder press,
// not lateral raise). Real lateral raises peak 90–110°; 130° gives 20–40°
// margin. Caught the 174° / 178° "arms overhead" reps from physical test logs.
const MAX_REP_PEAK_DEG = 130;
// 2026-05-28 round 19: below this = arms went FORWARD (front raise) not OUT
// to the sides. Ratio is |wrist.x − shoulder.x| / shoulderWidth, averaged
// across both arms. True lateral raise hits ~1.4; front raise stays near 0.
// 0.8 = 80% of shoulder-width outward — conservative lower bound.
const MIN_WRIST_OUTWARD_RATIO = 0.8;
// Defense-in-depth floor (Fix X analog) on baseline.shoulderWidth.
const MIN_SHOULDER_WIDTH_RUNTIME = 0.08;
// 2026-05-28 round 20: bumped 15 → 25. The original 15° was too tight for
// MediaPipe wrist landmark noise — single-frame mislocalization of one wrist
// (sometimes overhead, sometimes drifting) caused false-positive asymmetry
// rejections on real bilateral reps. 25° absorbs noise + genuine ~10° user
// asymmetry; clearly one-arm-only reps (peakDiff ≥ 60°) still rejected.
// Also see validateRepShape ordering change in this round: arms-too-high +
// arms-forward-not-side now checked BEFORE asymmetric so a mislocalized wrist
// at 160° reports the correct cheat instead of asymmetric.
const ARM_ASYMMETRY_DEG = 25;       // L vs R peak abduction diff at rep complete

const TORSO_SWING_THRESHOLD = 0.04;   // shoulder-mid X deviation from baseline
const TORSO_SWING_DEBOUNCE_FRAMES = 8;

const WARNING_REPEAT_COOLDOWN_MS = 2500;

// Fix I — 5s idle warning, mirrors bicep-curl / squat / lunge.
const NO_MOVEMENT_TIMEOUT_MS = 5000;
const NO_MOVEMENT_VARIANCE_DEG = 2;
const NO_MOVEMENT_REPEAT_MS = 15000;

// Fix N — position-lost detection.
const POSITION_LOST_TIMEOUT_MS = 3000;
const POSITION_LOST_REPEAT_MS = 10_000;

const MIN_REP_DURATION_MS = 400;
// Fix R — wrist landmark velocity. Lateral-raise wrist arc is ~1.7× the
// bicep-curl arc (hip-to-shoulder height ≈ 50 cm vs bicep ≈ 30 cm), so at
// the same rep tempo peak wrist velocity scales proportionally. Bicep-curl
// tuned at 4.0 → lateral-raise needs 5.0 headroom for fast-but-clean reps.
// Still rejects truly ballistic reps (synthesised 0°→100° in <200 ms peaks
// at v ≈ 7+).
const MAX_WRIST_VELOCITY = 5.0;

export class LateralRaiseEngine {
  private callbacks: LateralRaiseEngineCallbacks;
  private calibration: LateralRaiseCalibration;
  private baseline: LateralRaiseBaseline | null = null;

  private repState: LateralRaiseRepState = 'DOWN';
  private smoothedAbduction = 0;
  private prevSmoothedAbduction = 0;
  private stableTopCount = 0;
  private maxAbductionThisRep = 0;
  private repWristVelocities: number[] = [];
  private repFormCounts = { torsoOKCount: 0, symmetryOKCount: 0, totalCount: 0 };
  private repWarnings: Set<WarningType> = new Set();
  private prevWristY = 0;
  private prevWristTimestamp = 0;

  // Per-rep tracking
  private repStartedAt = 0;
  private repPeakLeftAbdDeg = 0;
  private repPeakRightAbdDeg = 0;
  // 2026-05-28 round 19: track max wrist-outward ratio during the rep.
  // Used in validateRepShape to detect front-raise-instead-of-lateral cheats.
  private repPeakWristOutwardRatio = 0;

  // Idle detection (no-movement in DOWN state) + Fix O EMA-decay reseed
  private downSince = 0;
  private downAbductionMin = Infinity;
  private downAbductionMax = -Infinity;
  private lastNoMovementWarnAt = 0;
  private downSettledSince = 0;
  private downBaselineReseeded = false;

  // Fix N — position-lost heartbeat
  private lastValidFrameAt = 0;
  private lastPositionLostWarnAt = 0;

  // Posture debounce counters
  private torsoSwingFrames = 0;

  private warningCooldowns: Partial<Record<WarningType, number>> = {};
  private finished = false;

  constructor(callbacks: LateralRaiseEngineCallbacks = {}) {
    this.callbacks = callbacks;
    this.calibration = new LateralRaiseCalibration();
  }

  update(landmarks: PoseLandmarks | null, now: number): void {
    if (this.finished) return;

    if (!this.calibration.isConfirmed()) {
      const calUpdate = this.calibration.update(landmarks, now);
      this.callbacks.onCalibrationUpdate?.(calUpdate);
      if (calUpdate.state === 'confirmed') {
        this.baseline = this.calibration.getBaseline();
        // Fix I — seed idle tracking on cal-confirm; else first frame
        // reports millions of ms idle → false-positive 'not-moving'.
        this.downSince = now;
        this.downAbductionMin = this.smoothedAbduction;
        this.downAbductionMax = this.smoothedAbduction;
        // Fix N — seed position-lost heartbeat.
        this.lastValidFrameAt = now;
        if (this.baseline) {
          debugLog('RAISE', 'CALIB', 'CONFIRMED', {
            shoulderWidth: +this.baseline.shoulderWidth.toFixed(3),
            shoulderMidX: +this.baseline.shoulderMidX.toFixed(3),
          });
        }
      }
      return;
    }

    // Fix N — position-lost check BEFORE the landmark-null early return.
    const haveValidFrame = !!landmarks && this.hasCoreLandmarks(landmarks);
    this.checkPositionLost(haveValidFrame, now);

    if (!haveValidFrame || !this.baseline) return;
    this.processTrackingFrame(landmarks!, now);
  }

  finish(): void { this.finished = true; }

  resetForNextSet(): void {
    this.repState = 'DOWN';
    this.smoothedAbduction = 0;
    this.prevSmoothedAbduction = 0;
    this.stableTopCount = 0;
    this.resetRepBuffers();
  }

  // ----------------------------------------------------------
  private processTrackingFrame(landmarks: PoseLandmarks, now: number): void {
    const baseline = this.baseline!;

    const ls = landmarks[LM.LEFT_SHOULDER];
    const rs = landmarks[LM.RIGHT_SHOULDER];
    const lw = landmarks[LM.LEFT_WRIST];
    const rw = landmarks[LM.RIGHT_WRIST];
    const lh = landmarks[LM.LEFT_HIP];
    const rh = landmarks[LM.RIGHT_HIP];

    const coreOk = lmVisible(ls) && lmVisible(rs) && lmVisible(lw) && lmVisible(rw)
      && lmVisible(lh) && lmVisible(rh);
    if (!coreOk) return;

    // Bilateral shoulder abduction
    const leftAbd = shoulderAbductionDeg(ls, lw, lh);
    const rightAbd = shoulderAbductionDeg(rs, rw, rh);
    const rawAbd = (leftAbd + rightAbd) / 2;

    this.smoothedAbduction = this.smoothedAbduction === 0
      ? rawAbd
      : EMA_ALPHA_ABDUCTION * rawAbd + (1 - EMA_ALPHA_ABDUCTION) * this.smoothedAbduction;

    // Wrist Y velocity (drives smoothness — wrist travels the arc during a raise)
    const wristMidY = (lw.y + rw.y) / 2;
    if (this.prevWristTimestamp > 0) {
      const dt = (now - this.prevWristTimestamp) / 1000;
      if (dt > 0) {
        const v = (wristMidY - this.prevWristY) / dt;
        if (this.repState === 'RISING' || this.repState === 'LOWERING') {
          this.repWristVelocities.push(v);
        }
      }
    }
    this.prevWristY = wristMidY;
    this.prevWristTimestamp = now;

    // Torso swing — shoulder midpoint X oscillates from baseline (momentum cheat)
    const shoulderMidX = (ls.x + rs.x) / 2;
    const torsoSwingActive = Math.abs(shoulderMidX - baseline.shoulderMidX) > TORSO_SWING_THRESHOLD;
    this.torsoSwingFrames = torsoSwingActive ? this.torsoSwingFrames + 1 : 0;
    const torsoSwingWarn = this.torsoSwingFrames >= TORSO_SWING_DEBOUNCE_FRAMES;

    // Bilateral symmetry per-frame (current asymmetry — for the form-score)
    const abdLo = Math.min(leftAbd, rightAbd);
    const abdHi = Math.max(leftAbd, rightAbd);
    const symmetryOK = abdHi < 10 || (abdHi - abdLo) < ARM_ASYMMETRY_DEG;

    // Form accumulation during active phases
    if (this.repState !== 'DOWN') {
      this.repFormCounts.totalCount++;
      if (!torsoSwingWarn) this.repFormCounts.torsoOKCount++;
      if (symmetryOK) this.repFormCounts.symmetryOKCount++;
    }

    if (torsoSwingWarn) this.repWarnings.add('torso-swing');

    // 2026-05-28 round 20: torso-swing CHIP/SPEECH emission disabled for
    // lateral-raise. Form-score still tracks shoulder drift via repFormCounts
    // above (penalizes momentum cheats), but the user-facing chip was firing
    // constantly during normal lateral raises (MediaPipe shoulder landmark
    // jitters laterally as arms extend) and the bicep-curl-styled text was
    // wrong for this exercise. Arms-too-high + arms-forward-not-side (round 19)
    // catch the actual lateral-raise cheats that matter.
    // Note: bicep-curl still emits torso-swing — this disable is engine-local.

    // Per-rep bilateral peak (for symmetry sanity check at rep complete)
    if (this.repState !== 'DOWN') {
      if (leftAbd > this.repPeakLeftAbdDeg) this.repPeakLeftAbdDeg = leftAbd;
      if (rightAbd > this.repPeakRightAbdDeg) this.repPeakRightAbdDeg = rightAbd;

      // 2026-05-28 round 19: track peak wrist-outward ratio for the rep.
      // Used to detect "arms went forward (front raise) not side (lateral)".
      const refShoulderWidth = Math.max(baseline.shoulderWidth, MIN_SHOULDER_WIDTH_RUNTIME);
      const leftOutward = Math.abs(lw.x - ls.x) / refShoulderWidth;
      const rightOutward = Math.abs(rw.x - rs.x) / refShoulderWidth;
      const avgOutward = (leftOutward + rightOutward) / 2;
      if (avgOutward > this.repPeakWristOutwardRatio) {
        this.repPeakWristOutwardRatio = avgOutward;
      }
    }

    this.checkNoMovement(now);
    this.advanceRepState(now);

    const frameMetrics: LateralRaiseFrameMetrics = {
      abductionDeg: rawAbd,
      smoothedFlexionDeg: this.smoothedAbduction,
      repState: this.repState,
      leftAbductionDeg: leftAbd,
      rightAbductionDeg: rightAbd,
      torsoSwing: torsoSwingWarn,
    };
    this.callbacks.onFrame?.(frameMetrics);

    this.prevSmoothedAbduction = this.smoothedAbduction;
  }

  // ----------------------------------------------------------
  private advanceRepState(now: number): void {
    switch (this.repState) {
      case 'DOWN':
        if (this.smoothedAbduction > ASCEND_START_DEG) {
          this.repState = 'RISING';
          // Fix C — reset FIRST, then set repStartedAt (else durationMs reports 0).
          this.resetRepBuffers();
          this.repStartedAt = now;
          debugLog('RAISE', 'STATE', 'DOWN → RISING', { abd: +this.smoothedAbduction.toFixed(1) });
        }
        break;

      case 'RISING': {
        this.maxAbductionThisRep = Math.max(this.maxAbductionThisRep, this.smoothedAbduction);
        const delta = Math.abs(this.smoothedAbduction - this.prevSmoothedAbduction);
        if (delta < TOP_STABILITY_DELTA) {
          this.stableTopCount++;
          if (this.stableTopCount >= TOP_STABILITY_FRAMES) {
            this.repState = 'AT_TOP';
            debugLog('RAISE', 'STATE', 'RISING → AT_TOP', { peak: +this.maxAbductionThisRep.toFixed(1) });
          }
        } else {
          this.stableTopCount = 0;
        }
        break;
      }

      case 'AT_TOP': {
        this.maxAbductionThisRep = Math.max(this.maxAbductionThisRep, this.smoothedAbduction);
        const deltaDown = this.smoothedAbduction - this.prevSmoothedAbduction;
        const dropFromPeak = this.maxAbductionThisRep - this.smoothedAbduction;
        if (deltaDown < -DESCENDING_DELTA_MIN || dropFromPeak >= DESCENT_FROM_PEAK_DEG) {
          this.repState = 'LOWERING';
          debugLog('RAISE', 'STATE', 'AT_TOP → LOWERING', { peak: +this.maxAbductionThisRep.toFixed(1) });
        }
        break;
      }

      case 'LOWERING':
        if (this.smoothedAbduction < DOWN_THRESHOLD_DEG) {
          this.completeRep(now);
          this.repState = 'DOWN';
          this.downSince = now;
          this.downAbductionMin = Infinity;
          this.downAbductionMax = -Infinity;
          this.downSettledSince = 0;
          this.downBaselineReseeded = false;
        }
        break;
    }
  }

  private validateRepShape(now: number): { ok: true } | { ok: false; reason: string } {
    // Order matters. 2026-05-28 round 20 reorder:
    //   1. too-shallow         — fundamental: didn't reach target height
    //   2. arms-too-high       — went overhead (specific cheat verdict)
    //   3. arms-forward-not-side — went forward (specific cheat verdict)
    //   4. asymmetric          — was hi-lo > 15° on rep peaks (was check #1
    //                            pre-round-20, but mislocalized single-wrist
    //                            MediaPipe noise was causing false rejects
    //                            here that arms-too-high handles correctly).
    //   5. too-fast            — duration check
    //   6. ballistic           — velocity check
    if (this.maxAbductionThisRep < MIN_REP_PEAK_DEG) {
      return { ok: false, reason: 'too-shallow' };
    }
    // 2026-05-28 round 19: arms went OVERHEAD (shoulder press, not lateral raise).
    if (this.maxAbductionThisRep > MAX_REP_PEAK_DEG) {
      return { ok: false, reason: 'arms-too-high' };
    }
    // 2026-05-28 round 19: arms went FORWARD (front raise) not OUT to the sides.
    // Only check this if abduction is in the valid range (75–130°) — at that
    // height the arms have to be EITHER outward (lateral) OR forward (front).
    if (this.repPeakWristOutwardRatio < MIN_WRIST_OUTWARD_RATIO) {
      return { ok: false, reason: 'arms-forward-not-side' };
    }
    // Fix D — bilateral symmetry. Moved to position #4 in round 20: see header.
    const peakSum = this.repPeakLeftAbdDeg + this.repPeakRightAbdDeg;
    if (peakSum > 0) {
      const lo = Math.min(this.repPeakLeftAbdDeg, this.repPeakRightAbdDeg);
      const hi = Math.max(this.repPeakLeftAbdDeg, this.repPeakRightAbdDeg);
      if (hi - lo > ARM_ASYMMETRY_DEG) return { ok: false, reason: 'asymmetric' };
    }
    if (this.repStartedAt > 0 && now - this.repStartedAt < MIN_REP_DURATION_MS) {
      return { ok: false, reason: 'too-fast' };
    }
    if (this.repWristVelocities.length > 0) {
      const peakV = Math.max(...this.repWristVelocities.map(Math.abs));
      if (peakV > MAX_WRIST_VELOCITY) return { ok: false, reason: 'ballistic' };
    }
    return { ok: true };
  }

  private completeRep(now: number): void {
    const validation = this.validateRepShape(now);
    if (!validation.ok) {
      const durationMs = this.repStartedAt > 0 ? now - this.repStartedAt : 0;
      debugLog('RAISE', 'REJECT', 'Rep discarded', {
        reason: validation.reason,
        peakAvg: +this.maxAbductionThisRep.toFixed(1),
        durationMs: Math.round(durationMs),
        leftPeak: +this.repPeakLeftAbdDeg.toFixed(1),
        rightPeak: +this.repPeakRightAbdDeg.toFixed(1),
      });
      if (validation.reason === 'too-shallow') {
        this.maybeEmitWarning('incomplete-raise', true, now);
      } else if (validation.reason === 'asymmetric') {
        this.maybeEmitWarning('arm-asymmetry', true, now);
      } else if (validation.reason === 'arms-too-high') {
        this.maybeEmitWarning('arms-too-high', true, now);
      } else if (validation.reason === 'arms-forward-not-side') {
        this.maybeEmitWarning('arms-forward-not-side', true, now);
      } else {
        this.maybeEmitWarning('malformed-rep', true, now);
      }
      this.resetRepBuffers();
      return;
    }

    const smoothness = getSmoothnessScore(this.repWristVelocities);
    const form = getFormScore(this.repFormCounts);
    const completion = getCompletionScore(this.maxAbductionThisRep);
    const mqs = computeMQS({ smoothness, form, completion });

    const repPayload = {
      depthDeg: Math.round(this.maxAbductionThisRep * 10) / 10,
      smoothness: Math.round(smoothness),
      form: Math.round(form),
      mqs: Math.round(mqs),
      warnings: Array.from(this.repWarnings),
    };
    debugLog('RAISE', 'REP', 'Rep complete', repPayload);
    this.callbacks.onRepComplete?.(repPayload);

    this.resetRepBuffers();
  }

  private checkNoMovement(now: number): void {
    if (this.repState !== 'DOWN') {
      this.downSince = now;
      this.downAbductionMin = this.smoothedAbduction;
      this.downAbductionMax = this.smoothedAbduction;
      this.downSettledSince = 0;
      this.downBaselineReseeded = false;
      return;
    }
    if (this.smoothedAbduction < this.downAbductionMin) this.downAbductionMin = this.smoothedAbduction;
    if (this.smoothedAbduction > this.downAbductionMax) this.downAbductionMax = this.smoothedAbduction;
    // Fix O — reseed baseline once EMA has settled, so the post-rep decay tail
    // doesn't inflate `max - min` permanently. Same shape as bicep-curl/lunge.
    if (!this.downBaselineReseeded) {
      const emaDelta = Math.abs(this.smoothedAbduction - this.prevSmoothedAbduction);
      if (emaDelta < 0.3) {
        if (this.downSettledSince === 0) this.downSettledSince = now;
        if (now - this.downSettledSince >= 500) {
          this.downAbductionMin = this.smoothedAbduction;
          this.downAbductionMax = this.smoothedAbduction;
          this.downSince = now;
          this.downBaselineReseeded = true;
        }
      } else {
        this.downSettledSince = 0;
      }
    }
    const idleMs = now - this.downSince;
    const variance = this.downAbductionMax - this.downAbductionMin;
    // Fix P — cold-start cooldown sentinel: treat initial 0 as "never fired".
    const firstFireAllowed = this.lastNoMovementWarnAt === 0
      || now - this.lastNoMovementWarnAt >= NO_MOVEMENT_REPEAT_MS;
    if (
      idleMs >= NO_MOVEMENT_TIMEOUT_MS
      && variance < NO_MOVEMENT_VARIANCE_DEG
      && firstFireAllowed
    ) {
      this.lastNoMovementWarnAt = now;
      debugLog('RAISE', 'WARN', 'not-moving', {
        idleMs: Math.round(idleMs),
        abdVariance: +variance.toFixed(2),
      });
      this.callbacks.onPostureWarning?.('not-moving');
      this.downSince = now;
      this.downAbductionMin = this.smoothedAbduction;
      this.downAbductionMax = this.smoothedAbduction;
      this.downSettledSince = 0;
      this.downBaselineReseeded = false;
    }
  }

  private resetRepBuffers(): void {
    this.maxAbductionThisRep = 0;
    this.stableTopCount = 0;
    this.repWristVelocities = [];
    this.repFormCounts = { torsoOKCount: 0, symmetryOKCount: 0, totalCount: 0 };
    this.repWarnings = new Set();
    this.repStartedAt = 0;
    this.repPeakLeftAbdDeg = 0;
    this.repPeakRightAbdDeg = 0;
    this.repPeakWristOutwardRatio = 0;
    this.torsoSwingFrames = 0;
  }

  private maybeEmitWarning(type: WarningType, active: boolean, now: number): void {
    if (!active) return;
    const last = this.warningCooldowns[type] ?? 0;
    if (now - last < WARNING_REPEAT_COOLDOWN_MS) return;
    this.warningCooldowns[type] = now;
    debugLog('RAISE', 'WARN', type);
    this.callbacks.onPostureWarning?.(type);
  }

  // ----------------------------------------------------------
  // Fix N — position-lost detection
  // ----------------------------------------------------------
  private hasCoreLandmarks(landmarks: PoseLandmarks): boolean {
    return lmVisible(landmarks[LM.LEFT_SHOULDER]) && lmVisible(landmarks[LM.RIGHT_SHOULDER])
      && lmVisible(landmarks[LM.LEFT_WRIST])    && lmVisible(landmarks[LM.RIGHT_WRIST])
      && lmVisible(landmarks[LM.LEFT_HIP])      && lmVisible(landmarks[LM.RIGHT_HIP]);
  }

  private checkPositionLost(haveValidFrame: boolean, now: number): void {
    if (haveValidFrame) {
      this.lastValidFrameAt = now;
      return;
    }
    const lostMs = now - this.lastValidFrameAt;
    if (lostMs < POSITION_LOST_TIMEOUT_MS) return;
    const firstFireAllowed = this.lastPositionLostWarnAt === 0
      || now - this.lastPositionLostWarnAt >= POSITION_LOST_REPEAT_MS;
    if (!firstFireAllowed) return;
    this.lastPositionLostWarnAt = now;
    debugLog('RAISE', 'WARN', 'position-lost', { lostMs: Math.round(lostMs) });
    this.callbacks.onPostureWarning?.('position-lost');
  }
}
