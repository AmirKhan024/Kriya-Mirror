/**
 * ArmCirclesEngine — 2026-05-28 round 21 re-architecture.
 *
 * Previously: side-camera, polar-coordinate cumulative-angle tracking with a
 * 2-state IDLE/CIRCLING machine. User physical test showed zero reps detected
 * because the user (correctly) wants to face the camera and trace large
 * overhead arm sweeps, not stand sideways tracing fixed-radius circles.
 *
 * Now: front-camera, bilateral 4-state DOWN/RISING/AT_TOP/LOWERING machine
 * (mirror lateral-raise). Each rep = one full sweep DOWN → overhead → DOWN.
 * The circular intent (forward/backward circles) is instructional only —
 * engine measures the vertical-amplitude oscillation.
 *
 * Key tuning vs lateral-raise:
 *   - MIN_REP_PEAK_DEG = 140 (arms must reach near-overhead — the differentiator
 *     from lateral-raise which caps at 130°)
 *   - NO MAX_REP_PEAK_DEG (overhead IS the target)
 *   - NO MIN_WRIST_OUTWARD_RATIO (motion can be in any plane — forward,
 *     lateral, or anywhere between is fine for arm circles)
 *   - ARM_ASYMMETRY_DEG = 30 (looser — circles aren't strictly symmetric;
 *     one arm leads slightly)
 *   - MIN_REP_DURATION_MS = 1500 (slower cadence — mobility, not strength)
 *
 * Round 21: torso-swing chip/speech emission disabled at engine level
 * (mirror lateral-raise round 20). Form-score still tracks.
 */
import type { PoseLandmarks } from '@/modules/pose/types';
import type { WarningType } from '@/store/workout';
import { LM, lmVisible } from './geometry';
import { shoulderAbductionDeg } from '@/modules/lateral-raise/geometry';
import { ArmCirclesCalibration } from './calibration';
import type {
  ArmCirclesBaseline, ArmCirclesEngineCallbacks, ArmCirclesFrameMetrics, ArmCirclesRepState,
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
const MIN_REP_PEAK_DEG = 140;       // arms must reach near-overhead

// 2026-05-28 round 21: looser than lateral-raise (25) — arm circles are a
// mobility movement and natural cadence has one arm leading the other.
const ARM_ASYMMETRY_DEG = 30;

const TORSO_SWING_THRESHOLD = 0.04;
const TORSO_SWING_DEBOUNCE_FRAMES = 8;

const WARNING_REPEAT_COOLDOWN_MS = 2500;

// Fix I — 5 s idle warning
const NO_MOVEMENT_TIMEOUT_MS = 5000;
const NO_MOVEMENT_VARIANCE_DEG = 2;
const NO_MOVEMENT_REPEAT_MS = 15000;

// Fix N — position-lost detection
const POSITION_LOST_TIMEOUT_MS = 3000;
const POSITION_LOST_REPEAT_MS = 10_000;

// 2026-05-28 round 21: 1500 ms minimum — arm circles are mobility, not strength.
// A full sweep down → overhead → down should take ≥ 1.5 s.
const MIN_REP_DURATION_MS = 1500;
// Wrist-Y velocity ballistic threshold — match lateral-raise (5.0).
const MAX_WRIST_VELOCITY = 5.0;

export class ArmCirclesEngine {
  private callbacks: ArmCirclesEngineCallbacks;
  private calibration: ArmCirclesCalibration;
  private baseline: ArmCirclesBaseline | null = null;

  private repState: ArmCirclesRepState = 'DOWN';
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

  constructor(callbacks: ArmCirclesEngineCallbacks = {}) {
    this.callbacks = callbacks;
    this.calibration = new ArmCirclesCalibration();
  }

  update(landmarks: PoseLandmarks | null, now: number): void {
    if (this.finished) return;

    if (!this.calibration.isConfirmed()) {
      const calUpdate = this.calibration.update(landmarks, now);
      this.callbacks.onCalibrationUpdate?.(calUpdate);
      if (calUpdate.state === 'confirmed') {
        this.baseline = this.calibration.getBaseline();
        // Fix I — seed idle tracking on cal-confirm.
        this.downSince = now;
        this.downAbductionMin = this.smoothedAbduction;
        this.downAbductionMax = this.smoothedAbduction;
        // Fix N — seed position-lost heartbeat.
        this.lastValidFrameAt = now;
        if (this.baseline) {
          debugLog('CIRCLES', 'CALIB', 'CONFIRMED', {
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

    // Bilateral shoulder abduction (plane-agnostic — works for any arm motion).
    const leftAbd = shoulderAbductionDeg(ls, lw, lh);
    const rightAbd = shoulderAbductionDeg(rs, rw, rh);
    const rawAbd = (leftAbd + rightAbd) / 2;

    this.smoothedAbduction = this.smoothedAbduction === 0
      ? rawAbd
      : EMA_ALPHA_ABDUCTION * rawAbd + (1 - EMA_ALPHA_ABDUCTION) * this.smoothedAbduction;

    // Wrist Y velocity (drives smoothness).
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

    // Torso swing — shoulder midpoint X oscillates from baseline.
    const shoulderMidX = (ls.x + rs.x) / 2;
    const torsoSwingActive = Math.abs(shoulderMidX - baseline.shoulderMidX) > TORSO_SWING_THRESHOLD;
    this.torsoSwingFrames = torsoSwingActive ? this.torsoSwingFrames + 1 : 0;
    const torsoSwingWarn = this.torsoSwingFrames >= TORSO_SWING_DEBOUNCE_FRAMES;

    // Bilateral symmetry per-frame (for the form score).
    const abdLo = Math.min(leftAbd, rightAbd);
    const abdHi = Math.max(leftAbd, rightAbd);
    const symmetryOK = abdHi < 10 || (abdHi - abdLo) < ARM_ASYMMETRY_DEG;

    // Form accumulation during active phases.
    if (this.repState !== 'DOWN') {
      this.repFormCounts.totalCount++;
      if (!torsoSwingWarn) this.repFormCounts.torsoOKCount++;
      if (symmetryOK) this.repFormCounts.symmetryOKCount++;
    }

    if (torsoSwingWarn) this.repWarnings.add('torso-swing');

    // 2026-05-28 round 21: torso-swing CHIP/SPEECH emission disabled for
    // arm-circles (mirror lateral-raise round 20). Form-score still tracks
    // shoulder drift via repFormCounts above. Arm circles naturally shift
    // the shoulder mid X as the body counter-balances overhead motion.

    // Per-rep bilateral peak (for asymmetry sanity check).
    if (this.repState !== 'DOWN') {
      if (leftAbd > this.repPeakLeftAbdDeg) this.repPeakLeftAbdDeg = leftAbd;
      if (rightAbd > this.repPeakRightAbdDeg) this.repPeakRightAbdDeg = rightAbd;
    }

    this.checkNoMovement(now);
    this.advanceRepState(now);

    const frameMetrics: ArmCirclesFrameMetrics = {
      abductionDeg: rawAbd,
      smoothedAbductionDeg: this.smoothedAbduction,
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
          // Fix C — reset FIRST, then set repStartedAt.
          this.resetRepBuffers();
          this.repStartedAt = now;
          debugLog('CIRCLES', 'STATE', 'DOWN → RISING', { abd: +this.smoothedAbduction.toFixed(1) });
        }
        break;

      case 'RISING': {
        this.maxAbductionThisRep = Math.max(this.maxAbductionThisRep, this.smoothedAbduction);
        const delta = Math.abs(this.smoothedAbduction - this.prevSmoothedAbduction);
        if (delta < TOP_STABILITY_DELTA) {
          this.stableTopCount++;
          if (this.stableTopCount >= TOP_STABILITY_FRAMES) {
            this.repState = 'AT_TOP';
            debugLog('CIRCLES', 'STATE', 'RISING → AT_TOP', { peak: +this.maxAbductionThisRep.toFixed(1) });
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
          debugLog('CIRCLES', 'STATE', 'AT_TOP → LOWERING', { peak: +this.maxAbductionThisRep.toFixed(1) });
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
    // Order:
    //   1. too-shallow         — didn't reach overhead (< 140°)
    //   2. asymmetric          — L vs R peak diff > 30°
    //   3. too-fast            — duration check
    //   4. ballistic           — wrist velocity
    if (this.maxAbductionThisRep < MIN_REP_PEAK_DEG) {
      return { ok: false, reason: 'too-shallow' };
    }
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
      debugLog('CIRCLES', 'REJECT', 'Rep discarded', {
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
    debugLog('CIRCLES', 'REP', 'Rep complete', repPayload);
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
    // Fix O — post-rep EMA-decay reseed.
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
    // Fix P — cold-start cooldown.
    const firstFireAllowed = this.lastNoMovementWarnAt === 0
      || now - this.lastNoMovementWarnAt >= NO_MOVEMENT_REPEAT_MS;
    if (
      idleMs >= NO_MOVEMENT_TIMEOUT_MS
      && variance < NO_MOVEMENT_VARIANCE_DEG
      && firstFireAllowed
    ) {
      this.lastNoMovementWarnAt = now;
      debugLog('CIRCLES', 'WARN', 'not-moving', {
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
    this.torsoSwingFrames = 0;
  }

  private maybeEmitWarning(type: WarningType, active: boolean, now: number): void {
    if (!active) return;
    const last = this.warningCooldowns[type] ?? 0;
    if (now - last < WARNING_REPEAT_COOLDOWN_MS) return;
    this.warningCooldowns[type] = now;
    debugLog('CIRCLES', 'WARN', type);
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
    debugLog('CIRCLES', 'WARN', 'position-lost', { lostMs: Math.round(lostMs) });
    this.callbacks.onPostureWarning?.('position-lost');
  }
}
