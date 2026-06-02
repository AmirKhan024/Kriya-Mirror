/**
 * FrontRaiseEngine — bilateral rep tracker for FRONT-camera front raise.
 *
 * 2026-05-28 round 23: LENIENT rollback. The round-21/22 plane discriminators
 * (arms-too-high overhead-press gate, arms-out-not-front lateral-raise gate)
 * were removed at user request — they rejected every legitimate forward raise
 * in physical tests because MediaPipe's 2D `shoulderAbductionDeg` helper
 * saturates near 180° for forward arms (perspective foreshortening). Front
 * raise now accepts forward, lateral, and overhead arm raises that reach
 * shoulder height — the engine just trusts the user's intent.
 *
 * Signal:
 *   leftFlexionDeg  = shoulderAbductionDeg(leftShoulder,  leftWrist,  leftHip)
 *   rightFlexionDeg = shoulderAbductionDeg(rightShoulder, rightWrist, rightHip)
 *   smoothedFlexion = EMA-smoothed average of left + right
 *
 * Posture warnings:
 *   - `arm-asymmetry`   — L vs R peak flexion differs > 25° at rep complete
 *   - `incomplete-raise`— peak avg flexion < MIN_REP_DEPTH_DEG (75°)
 *   - `malformed-rep`   — ballistic / too-fast
 *   - `not-moving`      — 5 s idle in DOWN
 *   - `position-lost`   — no usable frame for ≥ 3 s post-cal (Fix N)
 *
 * Round 21: torso-swing chip/speech emission disabled at engine level (mirror
 * lateral-raise round 20). Form-score still tracks via repFormCounts.
 */
import type { PoseLandmarks } from '@/modules/pose/types';
import type { WarningType } from '@/store/workout';
import { LM, lmVisible, shoulderAbductionDeg } from './geometry';
import { FrontRaiseCalibration } from './calibration';
import type {
  FrontRaiseBaseline, FrontRaiseEngineCallbacks, FrontRaiseFrameMetrics, FrontRaiseRepState,
} from './types';
import { computeMQS, getCompletionScore, getFormScore, getSmoothnessScore } from './scoring';
import { debugLog } from '@/lib/debug';

const EMA_ALPHA_FLEXION = 0.15;
const ASCEND_START_DEG = 25;
const TOP_STABILITY_FRAMES = 8;
const TOP_STABILITY_DELTA = 3;
const DESCENDING_DELTA_MIN = 3;
const DESCENT_FROM_PEAK_DEG = 10;
const DOWN_THRESHOLD_DEG = 18;
const MIN_REP_DEPTH_DEG = 75;        // arms must reach ≥75° flexion (near horizontal) to count
// 2026-05-28 round 23: plane discriminators (arms-too-high / arms-out-not-front)
// REMOVED. Front raise is now lenient — any reasonable arm raise to shoulder
// height counts, regardless of direction (forward, lateral, or overhead). The
// 2D shoulderAbductionDeg helper saturates near 180° for forward arms (perspective
// foreshortening), and the round-21/22 MediaPipe-based discriminators rejected
// every legitimate rep in physical tests. User explicitly requested rollback to
// the initial lenient version.
const ARM_ASYMMETRY_DEG = 25;        // L vs R peak diff at rep complete

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

const MIN_REP_DURATION_MS = 400;
// Fix R — wrist Y velocity threshold. Front raise has slow controlled cadence
// (3-count up, 3-count down). Same range as bicep-curl (4.0) — wrist arc is
// shorter than lateral-raise (~30 cm vs 50 cm) so the proportional threshold
// scales back down.
const MAX_WRIST_VELOCITY = 4.0;

export class FrontRaiseEngine {
  private callbacks: FrontRaiseEngineCallbacks;
  private calibration: FrontRaiseCalibration;
  private baseline: FrontRaiseBaseline | null = null;

  private repState: FrontRaiseRepState = 'DOWN';
  private smoothedFlexion = 0;
  private prevSmoothedFlexion = 0;
  private stableTopCount = 0;
  private maxFlexionThisRep = 0;
  private repWristVelocities: number[] = [];
  private repFormCounts = { torsoOKCount: 0, symmetryOKCount: 0, totalCount: 0 };
  private repWarnings: Set<WarningType> = new Set();
  private prevWristY = 0;
  private prevWristTimestamp = 0;

  // Per-rep bilateral peak tracking
  private repStartedAt = 0;
  private repPeakLeftFlexDeg = 0;
  private repPeakRightFlexDeg = 0;

  // Idle detection (no-movement in DOWN state) + Fix O EMA-decay reseed
  private downSince = 0;
  private downFlexionMin = Infinity;
  private downFlexionMax = -Infinity;
  private lastNoMovementWarnAt = 0;
  private downSettledSince = 0;
  private downBaselineReseeded = false;

  // Fix N — position-lost heartbeat
  private lastValidFrameAt = 0;
  private lastPositionLostWarnAt = 0;

  // Posture debounce counter
  private torsoSwingFrames = 0;

  private warningCooldowns: Partial<Record<WarningType, number>> = {};
  private finished = false;

  constructor(callbacks: FrontRaiseEngineCallbacks = {}) {
    this.callbacks = callbacks;
    this.calibration = new FrontRaiseCalibration();
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
        this.downFlexionMin = this.smoothedFlexion;
        this.downFlexionMax = this.smoothedFlexion;
        // Fix N — seed position-lost heartbeat.
        this.lastValidFrameAt = now;
        if (this.baseline) {
          debugLog('FRONT', 'CALIB', 'CONFIRMED', {
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
    this.smoothedFlexion = 0;
    this.prevSmoothedFlexion = 0;
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

    // Bilateral shoulder flexion (same helper as lateral-raise — angle is
    // plane-agnostic; side-view reads it as flexion).
    const leftFlex = shoulderAbductionDeg(ls, lw, lh);
    const rightFlex = shoulderAbductionDeg(rs, rw, rh);
    const rawFlex = (leftFlex + rightFlex) / 2;

    this.smoothedFlexion = this.smoothedFlexion === 0
      ? rawFlex
      : EMA_ALPHA_FLEXION * rawFlex + (1 - EMA_ALPHA_FLEXION) * this.smoothedFlexion;

    // Wrist Y velocity (drives smoothness — wrist travels the arc forward+up
    // during a front raise; Y velocity is the dominant component in side view).
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
    const flexLo = Math.min(leftFlex, rightFlex);
    const flexHi = Math.max(leftFlex, rightFlex);
    const symmetryOK = flexHi < 10 || (flexHi - flexLo) < ARM_ASYMMETRY_DEG;

    // Form accumulation during active phases.
    if (this.repState !== 'DOWN') {
      this.repFormCounts.totalCount++;
      if (!torsoSwingWarn) this.repFormCounts.torsoOKCount++;
      if (symmetryOK) this.repFormCounts.symmetryOKCount++;
    }

    if (torsoSwingWarn) this.repWarnings.add('torso-swing');

    // 2026-05-28 round 21: torso-swing CHIP/SPEECH emission disabled for
    // front-raise (mirror lateral-raise round 20). Form-score still tracks
    // shoulder drift via repFormCounts above (penalizes momentum cheats),
    // but the user-facing chip was firing constantly on natural front-raise
    // cadence and the text was wrong for this exercise. Arms-too-high +
    // arms-out-not-front catch the actual front-raise cheats that matter.

    // Per-rep bilateral peak (raw, for the asymmetry sanity check).
    if (this.repState !== 'DOWN') {
      if (leftFlex > this.repPeakLeftFlexDeg) this.repPeakLeftFlexDeg = leftFlex;
      if (rightFlex > this.repPeakRightFlexDeg) this.repPeakRightFlexDeg = rightFlex;
    }

    this.checkNoMovement(now);
    this.advanceRepState(now);

    const frameMetrics: FrontRaiseFrameMetrics = {
      flexionDeg: rawFlex,
      smoothedFlexionDeg: this.smoothedFlexion,
      repState: this.repState,
      leftFlexionDeg: leftFlex,
      rightFlexionDeg: rightFlex,
      torsoSwing: torsoSwingWarn,
    };
    this.callbacks.onFrame?.(frameMetrics);

    this.prevSmoothedFlexion = this.smoothedFlexion;
  }

  // ----------------------------------------------------------
  private advanceRepState(now: number): void {
    switch (this.repState) {
      case 'DOWN':
        if (this.smoothedFlexion > ASCEND_START_DEG) {
          this.repState = 'RISING';
          // Fix C — reset FIRST, then set repStartedAt.
          this.resetRepBuffers();
          this.repStartedAt = now;
          debugLog('FRONT', 'STATE', 'DOWN → RISING', { flex: +this.smoothedFlexion.toFixed(1) });
        }
        break;

      case 'RISING': {
        this.maxFlexionThisRep = Math.max(this.maxFlexionThisRep, this.smoothedFlexion);
        const delta = Math.abs(this.smoothedFlexion - this.prevSmoothedFlexion);
        if (delta < TOP_STABILITY_DELTA) {
          this.stableTopCount++;
          if (this.stableTopCount >= TOP_STABILITY_FRAMES) {
            this.repState = 'AT_TOP';
            debugLog('FRONT', 'STATE', 'RISING → AT_TOP', { peak: +this.maxFlexionThisRep.toFixed(1) });
          }
        } else {
          this.stableTopCount = 0;
        }
        break;
      }

      case 'AT_TOP': {
        this.maxFlexionThisRep = Math.max(this.maxFlexionThisRep, this.smoothedFlexion);
        const deltaDown = this.smoothedFlexion - this.prevSmoothedFlexion;
        const dropFromPeak = this.maxFlexionThisRep - this.smoothedFlexion;
        if (deltaDown < -DESCENDING_DELTA_MIN || dropFromPeak >= DESCENT_FROM_PEAK_DEG) {
          this.repState = 'LOWERING';
          debugLog('FRONT', 'STATE', 'AT_TOP → LOWERING', { peak: +this.maxFlexionThisRep.toFixed(1) });
        }
        break;
      }

      case 'LOWERING':
        if (this.smoothedFlexion < DOWN_THRESHOLD_DEG) {
          this.completeRep(now);
          this.repState = 'DOWN';
          this.downSince = now;
          this.downFlexionMin = Infinity;
          this.downFlexionMax = -Infinity;
          this.downSettledSince = 0;
          this.downBaselineReseeded = false;
        }
        break;
    }
  }

  private validateRepShape(now: number): { ok: true } | { ok: false; reason: string } {
    // 2026-05-28 round 23 — lenient rollback. Validation order:
    //   1. too-shallow  — didn't reach target height
    //   2. asymmetric   — L vs R peak diff > 25°
    //   3. too-fast     — duration check
    //   4. ballistic    — velocity check
    //
    // The round-21/22 plane discriminators (arms-too-high, arms-out-not-front)
    // were removed at user request — they kept rejecting legitimate forward
    // raises due to MediaPipe's 2D perspective foreshortening. Front raise is
    // now lenient: forward, lateral, and overhead arm raises all count.
    if (this.maxFlexionThisRep < MIN_REP_DEPTH_DEG) {
      return { ok: false, reason: 'too-shallow' };
    }
    const peakSum = this.repPeakLeftFlexDeg + this.repPeakRightFlexDeg;
    if (peakSum > 0) {
      const lo = Math.min(this.repPeakLeftFlexDeg, this.repPeakRightFlexDeg);
      const hi = Math.max(this.repPeakLeftFlexDeg, this.repPeakRightFlexDeg);
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
      debugLog('FRONT', 'REJECT', 'Rep discarded', {
        reason: validation.reason,
        peakAvg: +this.maxFlexionThisRep.toFixed(1),
        durationMs: Math.round(durationMs),
        leftPeak: +this.repPeakLeftFlexDeg.toFixed(1),
        rightPeak: +this.repPeakRightFlexDeg.toFixed(1),
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
    const completion = getCompletionScore(this.maxFlexionThisRep);
    const mqs = computeMQS({ smoothness, form, completion });

    const repPayload = {
      depthDeg: Math.round(this.maxFlexionThisRep * 10) / 10,
      smoothness: Math.round(smoothness),
      form: Math.round(form),
      mqs: Math.round(mqs),
      warnings: Array.from(this.repWarnings),
    };
    debugLog('FRONT', 'REP', 'Rep complete', repPayload);
    this.callbacks.onRepComplete?.(repPayload);

    this.resetRepBuffers();
  }

  private checkNoMovement(now: number): void {
    if (this.repState !== 'DOWN') {
      this.downSince = now;
      this.downFlexionMin = this.smoothedFlexion;
      this.downFlexionMax = this.smoothedFlexion;
      this.downSettledSince = 0;
      this.downBaselineReseeded = false;
      return;
    }
    if (this.smoothedFlexion < this.downFlexionMin) this.downFlexionMin = this.smoothedFlexion;
    if (this.smoothedFlexion > this.downFlexionMax) this.downFlexionMax = this.smoothedFlexion;
    // Fix O — post-rep EMA-decay reseed.
    if (!this.downBaselineReseeded) {
      const emaDelta = Math.abs(this.smoothedFlexion - this.prevSmoothedFlexion);
      if (emaDelta < 0.3) {
        if (this.downSettledSince === 0) this.downSettledSince = now;
        if (now - this.downSettledSince >= 500) {
          this.downFlexionMin = this.smoothedFlexion;
          this.downFlexionMax = this.smoothedFlexion;
          this.downSince = now;
          this.downBaselineReseeded = true;
        }
      } else {
        this.downSettledSince = 0;
      }
    }
    const idleMs = now - this.downSince;
    const variance = this.downFlexionMax - this.downFlexionMin;
    // Fix P — cold-start cooldown.
    const firstFireAllowed = this.lastNoMovementWarnAt === 0
      || now - this.lastNoMovementWarnAt >= NO_MOVEMENT_REPEAT_MS;
    if (
      idleMs >= NO_MOVEMENT_TIMEOUT_MS
      && variance < NO_MOVEMENT_VARIANCE_DEG
      && firstFireAllowed
    ) {
      this.lastNoMovementWarnAt = now;
      debugLog('FRONT', 'WARN', 'not-moving', {
        idleMs: Math.round(idleMs),
        flexVariance: +variance.toFixed(2),
      });
      this.callbacks.onPostureWarning?.('not-moving');
      this.downSince = now;
      this.downFlexionMin = this.smoothedFlexion;
      this.downFlexionMax = this.smoothedFlexion;
      this.downSettledSince = 0;
      this.downBaselineReseeded = false;
    }
  }

  private resetRepBuffers(): void {
    this.maxFlexionThisRep = 0;
    this.stableTopCount = 0;
    this.repWristVelocities = [];
    this.repFormCounts = { torsoOKCount: 0, symmetryOKCount: 0, totalCount: 0 };
    this.repWarnings = new Set();
    this.repStartedAt = 0;
    this.repPeakLeftFlexDeg = 0;
    this.repPeakRightFlexDeg = 0;
    this.torsoSwingFrames = 0;
  }

  private maybeEmitWarning(type: WarningType, active: boolean, now: number): void {
    if (!active) return;
    const last = this.warningCooldowns[type] ?? 0;
    if (now - last < WARNING_REPEAT_COOLDOWN_MS) return;
    this.warningCooldowns[type] = now;
    debugLog('FRONT', 'WARN', type);
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
    debugLog('FRONT', 'WARN', 'position-lost', { lostMs: Math.round(lostMs) });
    this.callbacks.onPostureWarning?.('position-lost');
  }
}
