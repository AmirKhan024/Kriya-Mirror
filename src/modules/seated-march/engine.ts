/**
 * SeatedMarchEngine — front-camera, rep-based, ALTERNATING per-side reps.
 * The seated analog of High Knees: sit tall on a chair and alternately lift each
 * knee toward the chest. Mirrors high-knees' engine + full rep fix-list.
 *
 * Per-side tracking: each knee has its own EMA-smoothed lift scalar (% of
 * shoulder width), computed against the per-side baseline knee Y. 3-state
 * machine BOTH_DOWN (rest) ↔ LEFT_UP ↔ RIGHT_UP. Reps count on EXIT from any UP
 * state — on the cross to the OTHER up state the current rep finalizes and the
 * next side's rep begins on the same frame.
 *
 * "Do not confuse a chair and a person": `hasCoreLandmarks` requires only
 * shoulders + hips + knees (NOT ankles — the feet sit near/under the chair and
 * foreshorten), and the SEATED calibration gate (calibration.ts) only confirms
 * for a clearly seated human (never a standing person or an empty chair).
 *
 * Posture warnings:
 *   - `low-knee-lift`  — rep complete but peak lift < MIN_REP_HEIGHT_PCT
 *   - `malformed-rep`  — too-fast (< 200 ms) or ballistic (> MAX velocity)
 *   - `not-moving`     — 5 s idle in BOTH_DOWN
 *   - `position-lost`  — no usable pose frame for ≥ 3 s post-cal
 *   (torso-swing tracked for form-score only — seniors sway; chip disabled,
 *    same as high-knees.)
 */
import type { PoseLandmarks } from '@/modules/pose/types';
import type { WarningType } from '@/store/workout';
import { LM, lmVisible, MIN_SHOULDER_WIDTH_RUNTIME, kneeLiftPctFromKnee, clampKneeDelta } from './geometry';
import { SeatedMarchCalibration } from './calibration';
import type {
  SeatedMarchBaseline, SeatedMarchEngineCallbacks, SeatedMarchFrameMetrics, SeatedMarchRepState,
} from './types';
import { computeMQS, getCompletionScore, getFormScore, getSmoothnessScore } from './scoring';
import { debugLog } from '@/lib/debug';

const EMA_ALPHA_KNEE = 0.30;

// State-machine thresholds (% of shoulder width). Gentler than standing high
// knees (seated lifts are smaller). Hysteresis gap = 10. TUNE in physical test.
const HIGH_THRESHOLD_PCT = 20;
const LOW_THRESHOLD_PCT = 10;
// Minimum peak lift to count a rep. ~28% ≈ a clear, intentional seated knee
// lift; filters barely-off-the-seat twitches.
const MIN_REP_HEIGHT_PCT = 28;
// Post-cal grace: suppress UP transitions briefly so noisy first-frame EMA
// seeds can't fire a ghost rep before the user lifts.
const MIN_TIME_AFTER_CAL_MS = 500;
// Cap raw per-rep peak against MediaPipe knee mis-localization spikes.
const MAX_REASONABLE_KNEE_LIFT_PCT = 120;

const TORSO_SWING_THRESHOLD = 0.04;
const TORSO_SWING_DEBOUNCE_FRAMES = 8;
const WARNING_REPEAT_COOLDOWN_MS = 2500;

// Idle (Fix I + Fix O + Fix P)
const NO_MOVEMENT_TIMEOUT_MS = 5000;
const NO_MOVEMENT_VARIANCE_PCT = 2.0;
const NO_MOVEMENT_REPEAT_MS = 15000;
const SETTLED_DELTA_PCT = 0.5;
const SETTLED_HOLD_MS = 500;

// Position-lost (Fix N)
const POSITION_LOST_TIMEOUT_MS = 3000;
const POSITION_LOST_REPEAT_MS = 10_000;

// Rep shape (Fix D order: too-shallow → too-fast → ballistic). Seated march is
// slow, so the duration floor only rejects absurdly fast twitches; the ballistic
// cap is high so genuinely slow reps are never false-rejected.
const MIN_REP_DURATION_MS = 200;
const MAX_KNEE_Y_VELOCITY = 8.0;     // Fix R

export class SeatedMarchEngine {
  private callbacks: SeatedMarchEngineCallbacks;
  private calibration: SeatedMarchCalibration;
  private baseline: SeatedMarchBaseline | null = null;

  private repState: SeatedMarchRepState = 'BOTH_DOWN';

  private smoothedLeftKneeY = 0;
  private smoothedRightKneeY = 0;
  private kneeYSeeded = false;

  private smoothedLeftLift = 0;
  private smoothedRightLift = 0;
  private prevSmoothedLeftLift = 0;
  private prevSmoothedRightLift = 0;

  private currentRepSide: 'left' | 'right' | null = null;
  private currentRepPeak = 0;
  private currentRepStartedAt = 0;
  private currentRepKneeVelocities: number[] = [];
  private currentRepFormCounts = { torsoOKCount: 0, totalCount: 0 };
  private currentRepWarnings: Set<WarningType> = new Set();
  private prevActiveKneeY = 0;
  private prevSampleTimestamp = 0;

  // Idle detection (BOTH_DOWN). Tracks variance of max(left, right) lift.
  private bothDownSince = 0;
  private bothDownMaxLiftMin = Infinity;
  private bothDownMaxLiftMax = -Infinity;
  private lastNoMovementWarnAt = 0;
  private bothDownSettledSince = 0;
  private bothDownBaselineReseeded = false;

  // Position-lost detection (Fix N)
  private lastValidFrameAt = 0;
  private lastPositionLostWarnAt = 0;

  // Post-cal grace timestamp (ghost-rep prevention).
  private calConfirmedAt = 0;

  private torsoSwingFrames = 0;

  private warningCooldowns: Partial<Record<WarningType, number>> = {};
  private finished = false;

  constructor(callbacks: SeatedMarchEngineCallbacks = {}) {
    this.callbacks = callbacks;
    this.calibration = new SeatedMarchCalibration();
  }

  update(landmarks: PoseLandmarks | null, now: number): void {
    if (this.finished) return;

    if (!this.calibration.isConfirmed()) {
      const calUpdate = this.calibration.update(landmarks, now);
      this.callbacks.onCalibrationUpdate?.(calUpdate);
      if (calUpdate.state === 'confirmed') {
        this.baseline = this.calibration.getBaseline();
        if (this.baseline) {
          this.smoothedLeftKneeY = this.baseline.baselineLeftKneeY;
          this.smoothedRightKneeY = this.baseline.baselineRightKneeY;
          this.kneeYSeeded = true;
          this.smoothedLeftLift = 0;
          this.smoothedRightLift = 0;
          this.prevSmoothedLeftLift = 0;
          this.prevSmoothedRightLift = 0;
          // Fix I + P: init idle tracking on cal-confirm.
          this.bothDownSince = now;
          this.bothDownMaxLiftMin = 0;
          this.bothDownMaxLiftMax = 0;
          this.lastValidFrameAt = now;
          this.calConfirmedAt = now;
          debugLog('MARCH', 'CALIB', 'CONFIRMED', {
            shoulderWidth: +this.baseline.shoulderWidth.toFixed(3),
            leftKneeY: +this.baseline.baselineLeftKneeY.toFixed(3),
            rightKneeY: +this.baseline.baselineRightKneeY.toFixed(3),
          });
        }
      }
      return;
    }

    const haveValidFrame = !!landmarks && this.hasCoreLandmarks(landmarks);
    this.checkPositionLost(haveValidFrame, now);

    if (!haveValidFrame || !this.baseline) return;
    this.processTrackingFrame(landmarks!, now);
  }

  finish(): void { this.finished = true; }

  resetForNextSet(): void {
    this.repState = 'BOTH_DOWN';
    this.smoothedLeftLift = 0;
    this.smoothedRightLift = 0;
    this.prevSmoothedLeftLift = 0;
    this.prevSmoothedRightLift = 0;
    this.resetRepBuffers();
  }

  // ----------------------------------------------------------
  private processTrackingFrame(landmarks: PoseLandmarks, now: number): void {
    const baseline = this.baseline!;

    const ls = landmarks[LM.LEFT_SHOULDER];
    const rs = landmarks[LM.RIGHT_SHOULDER];
    const lk = landmarks[LM.LEFT_KNEE];
    const rk = landmarks[LM.RIGHT_KNEE];

    const coreOk = lmVisible(ls) && lmVisible(rs) && lmVisible(lk) && lmVisible(rk);
    if (!coreOk) return;

    const clampedLeftY = this.kneeYSeeded ? clampKneeDelta(lk.y, this.smoothedLeftKneeY) : lk.y;
    const clampedRightY = this.kneeYSeeded ? clampKneeDelta(rk.y, this.smoothedRightKneeY) : rk.y;

    this.smoothedLeftKneeY = this.kneeYSeeded
      ? EMA_ALPHA_KNEE * clampedLeftY + (1 - EMA_ALPHA_KNEE) * this.smoothedLeftKneeY
      : clampedLeftY;
    this.smoothedRightKneeY = this.kneeYSeeded
      ? EMA_ALPHA_KNEE * clampedRightY + (1 - EMA_ALPHA_KNEE) * this.smoothedRightKneeY
      : clampedRightY;
    this.kneeYSeeded = true;

    const leftKneeLiftPct = kneeLiftPctFromKnee(lk.y, baseline.baselineLeftKneeY, baseline.shoulderWidth);
    const rightKneeLiftPct = kneeLiftPctFromKnee(rk.y, baseline.baselineRightKneeY, baseline.shoulderWidth);

    this.prevSmoothedLeftLift = this.smoothedLeftLift;
    this.prevSmoothedRightLift = this.smoothedRightLift;
    this.smoothedLeftLift = kneeLiftPctFromKnee(this.smoothedLeftKneeY, baseline.baselineLeftKneeY, baseline.shoulderWidth);
    this.smoothedRightLift = kneeLiftPctFromKnee(this.smoothedRightKneeY, baseline.baselineRightKneeY, baseline.shoulderWidth);

    // Velocity sampling — per-frame Y velocity of the ACTIVE side.
    if (this.prevSampleTimestamp > 0 && this.currentRepSide !== null) {
      const dt = (now - this.prevSampleTimestamp) / 1000;
      if (dt > 0) {
        const activeKneeY = this.currentRepSide === 'left' ? lk.y : rk.y;
        const v = (activeKneeY - this.prevActiveKneeY) / dt;
        this.currentRepKneeVelocities.push(v);
      }
    }
    if (this.currentRepSide !== null) {
      this.prevActiveKneeY = this.currentRepSide === 'left' ? lk.y : rk.y;
    }
    this.prevSampleTimestamp = now;

    // Torso swing — shoulder-mid X drift from baseline (form-score only).
    const shoulderMidX = (ls.x + rs.x) / 2;
    const torsoSwingActive = Math.abs(shoulderMidX - baseline.shoulderMidX) > TORSO_SWING_THRESHOLD;
    this.torsoSwingFrames = torsoSwingActive ? this.torsoSwingFrames + 1 : 0;
    const torsoSwingWarn = this.torsoSwingFrames >= TORSO_SWING_DEBOUNCE_FRAMES;

    if (this.repState !== 'BOTH_DOWN') {
      this.currentRepFormCounts.totalCount++;
      if (!torsoSwingWarn) this.currentRepFormCounts.torsoOKCount++;
    }
    if (torsoSwingWarn) this.currentRepWarnings.add('torso-swing');
    // Torso-swing CHIP/SPEECH disabled (mirror high-knees) — seniors sway as
    // they march; form-score still tracks the drift above.

    // Per-rep peak (RAW lift, clamped against landmark spikes).
    if (this.currentRepSide === 'left') {
      const clamped = Math.min(leftKneeLiftPct, MAX_REASONABLE_KNEE_LIFT_PCT);
      if (clamped > this.currentRepPeak) this.currentRepPeak = clamped;
    } else if (this.currentRepSide === 'right') {
      const clamped = Math.min(rightKneeLiftPct, MAX_REASONABLE_KNEE_LIFT_PCT);
      if (clamped > this.currentRepPeak) this.currentRepPeak = clamped;
    }

    this.checkNoMovement(now);
    this.advanceRepState(now);

    const frameMetrics: SeatedMarchFrameMetrics = {
      leftKneeLiftPct,
      rightKneeLiftPct,
      smoothedLeftLift: this.smoothedLeftLift,
      smoothedRightLift: this.smoothedRightLift,
      repState: this.repState,
      torsoSwing: torsoSwingWarn,
    };
    this.callbacks.onFrame?.(frameMetrics);
  }

  // ----------------------------------------------------------
  private advanceRepState(now: number): void {
    const sL = this.smoothedLeftLift;
    const sR = this.smoothedRightLift;
    const leftUp = sL > HIGH_THRESHOLD_PCT;
    const leftDown = sL < LOW_THRESHOLD_PCT;
    const rightUp = sR > HIGH_THRESHOLD_PCT;
    const rightDown = sR < LOW_THRESHOLD_PCT;

    switch (this.repState) {
      case 'BOTH_DOWN': {
        if (this.calConfirmedAt > 0 && now - this.calConfirmedAt < MIN_TIME_AFTER_CAL_MS) break;
        if (leftUp && sL > sR) {
          this.startRep('left', now);
          this.repState = 'LEFT_UP';
          debugLog('MARCH', 'STATE', 'BOTH_DOWN → LEFT_UP', { left: +sL.toFixed(2) });
        } else if (rightUp && sR > sL) {
          this.startRep('right', now);
          this.repState = 'RIGHT_UP';
          debugLog('MARCH', 'STATE', 'BOTH_DOWN → RIGHT_UP', { right: +sR.toFixed(2) });
        }
        break;
      }

      case 'LEFT_UP':
        if (rightUp && sR > sL) {
          this.completeRep(now);
          this.startRep('right', now);
          this.repState = 'RIGHT_UP';
          debugLog('MARCH', 'STATE', 'LEFT_UP → RIGHT_UP', { right: +sR.toFixed(2) });
        } else if (leftDown && rightDown) {
          this.completeRep(now);
          this.repState = 'BOTH_DOWN';
          this.resetBothDownTracking(now);
          debugLog('MARCH', 'STATE', 'LEFT_UP → BOTH_DOWN', {});
        }
        break;

      case 'RIGHT_UP':
        if (leftUp && sL > sR) {
          this.completeRep(now);
          this.startRep('left', now);
          this.repState = 'LEFT_UP';
          debugLog('MARCH', 'STATE', 'RIGHT_UP → LEFT_UP', { left: +sL.toFixed(2) });
        } else if (leftDown && rightDown) {
          this.completeRep(now);
          this.repState = 'BOTH_DOWN';
          this.resetBothDownTracking(now);
          debugLog('MARCH', 'STATE', 'RIGHT_UP → BOTH_DOWN', {});
        }
        break;
    }
  }

  private startRep(side: 'left' | 'right', now: number): void {
    // Fix C: reset BEFORE setting timestamp.
    this.resetRepBuffers();
    this.currentRepSide = side;
    this.currentRepStartedAt = now;
    this.prevActiveKneeY = side === 'left' ? this.smoothedLeftKneeY : this.smoothedRightKneeY;
  }

  private validateRepShape(now: number): { ok: true } | { ok: false; reason: string } {
    // Fix D: too-shallow → too-fast → ballistic. No unilateral check (reps are
    // alternating-unilateral by design — enforced by the state machine).
    if (this.currentRepPeak < MIN_REP_HEIGHT_PCT) {
      return { ok: false, reason: 'too-shallow' };
    }
    if (this.currentRepStartedAt > 0 && now - this.currentRepStartedAt < MIN_REP_DURATION_MS) {
      return { ok: false, reason: 'too-fast' };
    }
    if (this.currentRepKneeVelocities.length > 0) {
      const peakV = Math.max(...this.currentRepKneeVelocities.map(Math.abs));
      if (peakV > MAX_KNEE_Y_VELOCITY) return { ok: false, reason: 'ballistic' };
    }
    return { ok: true };
  }

  private completeRep(now: number): void {
    if (this.currentRepSide === null) return;
    const side = this.currentRepSide;

    const validation = this.validateRepShape(now);
    if (!validation.ok) {
      const durationMs = this.currentRepStartedAt > 0 ? now - this.currentRepStartedAt : 0;
      debugLog('MARCH', 'REJECT', 'Rep discarded', {
        reason: validation.reason,
        side,
        peak: +this.currentRepPeak.toFixed(2),
        durationMs: Math.round(durationMs),
      });
      if (validation.reason === 'too-shallow') {
        this.maybeEmitWarning('low-knee-lift', true, now);
      } else {
        this.maybeEmitWarning('malformed-rep', true, now);
      }
      this.currentRepSide = null;
      return;
    }

    const smoothness = getSmoothnessScore(this.currentRepKneeVelocities);
    const form = getFormScore(this.currentRepFormCounts);
    const completion = getCompletionScore(this.currentRepPeak);
    const mqs = computeMQS({ smoothness, form, completion });

    const repPayload = {
      depthDeg: Math.round(this.currentRepPeak * 10) / 10,
      smoothness: Math.round(smoothness),
      form: Math.round(form),
      mqs: Math.round(mqs),
      side,
      warnings: Array.from(this.currentRepWarnings),
    };
    debugLog('MARCH', 'REP', 'Rep complete', repPayload);
    this.callbacks.onRepComplete?.(repPayload);

    this.currentRepSide = null;
  }

  private resetBothDownTracking(now: number): void {
    this.bothDownSince = now;
    this.bothDownMaxLiftMin = Infinity;
    this.bothDownMaxLiftMax = -Infinity;
    this.bothDownSettledSince = 0;
    this.bothDownBaselineReseeded = false;
  }

  private checkNoMovement(now: number): void {
    if (this.repState !== 'BOTH_DOWN') {
      this.bothDownSince = now;
      const maxLift = Math.max(this.smoothedLeftLift, this.smoothedRightLift);
      this.bothDownMaxLiftMin = maxLift;
      this.bothDownMaxLiftMax = maxLift;
      this.bothDownSettledSince = 0;
      this.bothDownBaselineReseeded = false;
      return;
    }
    const maxLift = Math.max(this.smoothedLeftLift, this.smoothedRightLift);
    if (maxLift < this.bothDownMaxLiftMin) this.bothDownMaxLiftMin = maxLift;
    if (maxLift > this.bothDownMaxLiftMax) this.bothDownMaxLiftMax = maxLift;
    // Fix O — post-rep EMA-decay reseed.
    if (!this.bothDownBaselineReseeded) {
      const leftDelta = Math.abs(this.smoothedLeftLift - this.prevSmoothedLeftLift);
      const rightDelta = Math.abs(this.smoothedRightLift - this.prevSmoothedRightLift);
      const maxDelta = Math.max(leftDelta, rightDelta);
      if (maxDelta < SETTLED_DELTA_PCT) {
        if (this.bothDownSettledSince === 0) this.bothDownSettledSince = now;
        if (now - this.bothDownSettledSince >= SETTLED_HOLD_MS) {
          this.bothDownMaxLiftMin = maxLift;
          this.bothDownMaxLiftMax = maxLift;
          this.bothDownSince = now;
          this.bothDownBaselineReseeded = true;
        }
      } else {
        this.bothDownSettledSince = 0;
      }
    }
    const idleMs = now - this.bothDownSince;
    const variance = this.bothDownMaxLiftMax - this.bothDownMaxLiftMin;
    // Fix P — cold-start cooldown.
    const firstFireAllowed = this.lastNoMovementWarnAt === 0
      || now - this.lastNoMovementWarnAt >= NO_MOVEMENT_REPEAT_MS;
    if (
      idleMs >= NO_MOVEMENT_TIMEOUT_MS
      && variance < NO_MOVEMENT_VARIANCE_PCT
      && firstFireAllowed
    ) {
      this.lastNoMovementWarnAt = now;
      debugLog('MARCH', 'WARN', 'not-moving', {
        idleMs: Math.round(idleMs),
        variance: +variance.toFixed(2),
      });
      this.callbacks.onPostureWarning?.('not-moving');
      this.bothDownSince = now;
      this.bothDownMaxLiftMin = maxLift;
      this.bothDownMaxLiftMax = maxLift;
      this.bothDownSettledSince = 0;
      this.bothDownBaselineReseeded = false;
    }
  }

  private resetRepBuffers(): void {
    this.currentRepSide = null;
    this.currentRepPeak = 0;
    this.currentRepStartedAt = 0;
    this.currentRepKneeVelocities = [];
    this.currentRepFormCounts = { torsoOKCount: 0, totalCount: 0 };
    this.currentRepWarnings = new Set();
    this.torsoSwingFrames = 0;
  }

  private maybeEmitWarning(type: WarningType, active: boolean, now: number): void {
    if (!active) return;
    const last = this.warningCooldowns[type] ?? 0;
    if (now - last < WARNING_REPEAT_COOLDOWN_MS) return;
    this.warningCooldowns[type] = now;
    debugLog('MARCH', 'WARN', type);
    this.callbacks.onPostureWarning?.(type);
  }

  // ----------------------------------------------------------
  // Fix N — position-lost detection
  // ----------------------------------------------------------

  /** Core landmark set: shoulders + hips + knees. NOT ankles — seated, the feet
   *  sit near/under the chair and foreshorten; the knee is the reliable signal.
   *  This is one of the three "don't confuse a chair and a person" guards. */
  private hasCoreLandmarks(landmarks: PoseLandmarks): boolean {
    return lmVisible(landmarks[LM.LEFT_SHOULDER]) && lmVisible(landmarks[LM.RIGHT_SHOULDER])
      && lmVisible(landmarks[LM.LEFT_HIP])      && lmVisible(landmarks[LM.RIGHT_HIP])
      && lmVisible(landmarks[LM.LEFT_KNEE])     && lmVisible(landmarks[LM.RIGHT_KNEE]);
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
    debugLog('MARCH', 'WARN', 'position-lost', { lostMs: Math.round(lostMs) });
    this.callbacks.onPostureWarning?.('position-lost');
  }

  static readonly MIN_SHOULDER_WIDTH_RUNTIME = MIN_SHOULDER_WIDTH_RUNTIME;
}
