/**
 * SideBendEngine — front-camera, rep-based, standing oblique side bend.
 *
 * Stand facing the camera; bend the torso laterally to one side (reach a hand
 * down the outside of the thigh), return to upright, repeat — on one side or
 * alternating. Cloned from SideLegRaiseEngine: identical 3-state per-direction
 * machine, but the tracked metric is LATERAL TORSO LEAN (frontal plane). A
 * single signed lean (sign = which way the shoulders shifted off the hips) is
 * smoothed, then split into per-direction lift.
 *
 * State transitions (hysteresis HIGH=12° vs LOW=6°):
 *   UPRIGHT   → LEFT_BENT  : smoothedLeftLift > HIGH
 *   LEFT_BENT → RIGHT_BENT : right now leads past HIGH (finalizes left rep)
 *   LEFT_BENT → UPRIGHT    : both lifts < LOW (finalizes left rep)
 *   (RIGHT_BENT mirrored)
 *
 * Posture warnings:
 *   - `incomplete-bend` — rep complete but peak lean lift < MIN_REP_LEAN_DEG
 *   - `malformed-rep`   — too-fast (< 300 ms) or ballistic (shoulder > MAX_SHOULDER_VELOCITY)
 *   - `not-moving`      — 5 s idle upright (Fix I/O/P)
 *   - `position-lost`   — no usable pose frame for ≥ 3 s post-cal (Fix N)
 */
import type { PoseLandmarks } from '@/modules/pose/types';
import type { WarningType } from '@/store/workout';
import {
  LM, lmVisible, midpoint, MIN_SHOULDER_WIDTH_RUNTIME, lateralLeanDeg, clampLeanDelta,
} from './geometry';
import { SideBendCalibration } from './calibration';
import type {
  SideBendBaseline, SideBendEngineCallbacks, SideBendFrameMetrics, SideBendRepState,
} from './types';
import { computeMQS, getCompletionScore, getSmoothnessScore } from './scoring';
import { debugLog } from '@/lib/debug';

const EMA_ALPHA_LEAN = 0.30;

// State-machine thresholds (degrees of lateral-lean lift above standing baseline).
// Hysteresis gap = 6. Lateral spinal flexion ROM is ~0–35°.
const HIGH_THRESHOLD_DEG = 12;
const LOW_THRESHOLD_DEG = 6;
// Valid-rep peak floor — a clearly-deliberate FULL lateral bend. Counting is
// strictly binary (a rep either reaches this or it does not count; there is no
// partial-rep credit). Aligns with the reference standing_lateral_flexion's
// 20° valid floor.
const MIN_REP_LEAN_DEG = 22;
// Post-cal grace so noisy first-frame EMA seeds can't fire a ghost rep.
const MIN_TIME_AFTER_CAL_MS = 500;
// Outlier ceiling on the raw per-rep peak (caps a single MediaPipe spike before
// the physiological reject below evaluates it).
const MAX_REASONABLE_LEAN_DEG = 60;
// Above this, a "lateral lean" is physiologically implausible — almost always a
// forward fold / rotation inflating the metric (the atan2 denominator shrinks
// as the shoulders drop toward the hips). Reject the rep. (The reference uses a
// 60° cap on a non-inflating metric; ours inflates near vertical, so we cap
// lower.)
const MAX_PHYSIOLOGICAL_LEAN_DEG = 48;

// Forward-fold rejection (ported from standing_lateral_flexion). During a bend,
// compare the shoulder's vertical drop vs its lateral shift, both measured
// relative to the calibration baseline. A true lateral bend drops the shoulder
// only a little per unit of lateral shift (≈ a rigid-rod tan(θ/2)); a forward
// fold drops it far more. Frames exceeding the ratio are flagged; if enough of
// the bend is forward-folded, the rep is rejected as non-lateral.
const FORWARD_FOLD_MIN_ANGLE_DEG = 12;          // only evaluate above this lean
const FORWARD_FOLD_MIN_HORIZONTAL_SHIFT = 0.02; // need real lateral motion to judge
const FORWARD_FOLD_VH_RATIO_MAX = 4.5;          // actualVH > expectedVH × this ⇒ fold frame
const FORWARD_FOLD_VIOLATION_FRACTION = 0.40;   // ≥40% fold frames ⇒ reject the rep

const WARNING_REPEAT_COOLDOWN_MS = 2500;

// Idle (Fix I + Fix O + Fix P)
const NO_MOVEMENT_TIMEOUT_MS = 5000;
const NO_MOVEMENT_VARIANCE_DEG = 2.0;
const NO_MOVEMENT_REPEAT_MS = 15000;
const SETTLED_DELTA_DEG = 0.5;
const SETTLED_HOLD_MS = 500;

// Position-lost (Fix N)
const POSITION_LOST_TIMEOUT_MS = 3000;
const POSITION_LOST_REPEAT_MS = 10_000;

// Rep shape (Fix D order: too-shallow → too-fast → ballistic). Controlled move.
const MIN_REP_DURATION_MS = 300;
const MAX_SHOULDER_VELOCITY = 4.0;   // nu/sec — lenient; clean reps never trip it

export class SideBendEngine {
  private callbacks: SideBendEngineCallbacks;
  private calibration: SideBendCalibration;
  private baseline: SideBendBaseline | null = null;

  private repState: SideBendRepState = 'UPRIGHT';

  // EMA-smoothed SIGNED lateral lean (negative = bent left, positive = bent right).
  private smoothedSignedLean = 0;
  private leanSeeded = false;
  private baselineSignedLean = 0;

  // Per-direction smoothed lift + previous-frame value (for EMA-decay-tail).
  private smoothedLeftLift = 0;
  private smoothedRightLift = 0;
  private prevSmoothedLeftLift = 0;
  private prevSmoothedRightLift = 0;

  // Active rep tracking.
  private currentRepSide: 'left' | 'right' | null = null;
  private currentRepPeak = 0;
  private currentRepStartedAt = 0;
  private currentRepShoulderVelocities: number[] = [];
  private currentRepWarnings: Set<WarningType> = new Set();
  private prevShoulderMid: { x: number; y: number } | null = null;
  private prevSampleTimestamp = 0;

  // Forward-fold accounting (per rep). A bend with too many forward-fold frames
  // is rejected as non-lateral.
  private currentRepActiveFrames = 0;
  private currentRepForwardFoldFrames = 0;

  // Idle detection (UPRIGHT). Tracks variance of max(left, right) lift.
  private uprightSince = 0;
  private uprightMaxLiftMin = Infinity;
  private uprightMaxLiftMax = -Infinity;
  private lastNoMovementWarnAt = 0;
  // Fix O — post-rep EMA-decay reseed flags.
  private uprightSettledSince = 0;
  private uprightBaselineReseeded = false;

  // Position-lost detection (Fix N)
  private lastValidFrameAt = 0;
  private lastPositionLostWarnAt = 0;

  // Post-cal grace timestamp (ghost-rep prevention).
  private calConfirmedAt = 0;

  private warningCooldowns: Partial<Record<WarningType, number>> = {};
  private finished = false;

  constructor(callbacks: SideBendEngineCallbacks = {}) {
    this.callbacks = callbacks;
    this.calibration = new SideBendCalibration();
  }

  update(landmarks: PoseLandmarks | null, now: number): void {
    if (this.finished) return;

    if (!this.calibration.isConfirmed()) {
      const calUpdate = this.calibration.update(landmarks, now);
      this.callbacks.onCalibrationUpdate?.(calUpdate);
      if (calUpdate.state === 'confirmed') {
        this.baseline = this.calibration.getBaseline();
        if (this.baseline) {
          // Signed baseline: right-positive, left-negative (one term is 0).
          this.baselineSignedLean = this.baseline.baselineRightLeanDeg - this.baseline.baselineLeftLeanDeg;
          this.smoothedSignedLean = this.baselineSignedLean;
          this.leanSeeded = true;
          this.smoothedLeftLift = 0;
          this.smoothedRightLift = 0;
          this.prevSmoothedLeftLift = 0;
          this.prevSmoothedRightLift = 0;
          // Fix I + P: init idle tracking on cal-confirm.
          this.uprightSince = now;
          this.uprightMaxLiftMin = 0;
          this.uprightMaxLiftMax = 0;
          this.lastValidFrameAt = now;
          this.calConfirmedAt = now;
          debugLog('SIDEBEND', 'CALIB', 'CONFIRMED', {
            shoulderWidth: +this.baseline.shoulderWidth.toFixed(3),
            baselineSignedLean: +this.baselineSignedLean.toFixed(1),
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
    this.repState = 'UPRIGHT';
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
    const lh = landmarks[LM.LEFT_HIP];
    const rh = landmarks[LM.RIGHT_HIP];

    const coreOk = lmVisible(ls) && lmVisible(rs) && lmVisible(lh) && lmVisible(rh);
    if (!coreOk) return;

    const shoulderMid = midpoint(ls, rs);
    const hipMid = midpoint(lh, rh);

    // Signed lateral lean (negative = bent left, positive = bent right).
    const leanMag = lateralLeanDeg(shoulderMid, hipMid);
    const rawSignedLean = (shoulderMid.x - hipMid.x < 0 ? -1 : 1) * leanMag;

    // Clamp against previous smoothed, then EMA.
    const clamped = this.leanSeeded ? clampLeanDelta(rawSignedLean, this.smoothedSignedLean) : rawSignedLean;
    this.smoothedSignedLean = this.leanSeeded
      ? EMA_ALPHA_LEAN * clamped + (1 - EMA_ALPHA_LEAN) * this.smoothedSignedLean
      : clamped;
    this.leanSeeded = true;

    // Raw per-direction lift (degrees above standing baseline).
    const rawLiftSigned = rawSignedLean - this.baselineSignedLean;
    const leftLift = Math.max(0, -rawLiftSigned);
    const rightLift = Math.max(0, rawLiftSigned);

    // Smoothed per-direction lift — drives the state machine.
    this.prevSmoothedLeftLift = this.smoothedLeftLift;
    this.prevSmoothedRightLift = this.smoothedRightLift;
    const smoothedLiftSigned = this.smoothedSignedLean - this.baselineSignedLean;
    this.smoothedLeftLift = Math.max(0, -smoothedLiftSigned);
    this.smoothedRightLift = Math.max(0, smoothedLiftSigned);

    // Velocity sampling — shoulder-mid position velocity (nu/sec) during a rep.
    if (this.prevSampleTimestamp > 0 && this.currentRepSide !== null && this.prevShoulderMid) {
      const dt = (now - this.prevSampleTimestamp) / 1000;
      if (dt > 0) {
        const v = Math.hypot(shoulderMid.x - this.prevShoulderMid.x, shoulderMid.y - this.prevShoulderMid.y) / dt;
        this.currentRepShoulderVelocities.push(v);
      }
    }
    if (this.currentRepSide !== null) {
      this.prevShoulderMid = { x: shoulderMid.x, y: shoulderMid.y };
    }
    this.prevSampleTimestamp = now;

    // Per-rep peak uses RAW lift (not smoothed). Clamp outliers.
    if (this.currentRepSide === 'left') {
      const clampedPeak = Math.min(leftLift, MAX_REASONABLE_LEAN_DEG);
      if (clampedPeak > this.currentRepPeak) this.currentRepPeak = clampedPeak;
    } else if (this.currentRepSide === 'right') {
      const clampedPeak = Math.min(rightLift, MAX_REASONABLE_LEAN_DEG);
      if (clampedPeak > this.currentRepPeak) this.currentRepPeak = clampedPeak;
    }

    // Forward-fold / non-lateral accounting during an active bend. Compares the
    // shoulder's vertical drop vs its lateral shift (relative to the calibration
    // baseline) against a rigid-rod expectation; a forward fold drops the
    // shoulder far more than a true lateral bend.
    if (this.currentRepSide !== null) {
      this.currentRepActiveFrames++;
      const absLift = Math.abs(smoothedLiftSigned);
      const dShoulderXdiff = (shoulderMid.x - baseline.shoulderMid.x) - (hipMid.x - baseline.hipMid.x);
      const dShoulderYdiff = (shoulderMid.y - baseline.shoulderMid.y) - (hipMid.y - baseline.hipMid.y);
      if (
        absLift > FORWARD_FOLD_MIN_ANGLE_DEG
        && Math.abs(dShoulderXdiff) > FORWARD_FOLD_MIN_HORIZONTAL_SHIFT
        && dShoulderYdiff > 0
      ) {
        const theta = (absLift * Math.PI) / 180;
        const expectedVH = (1 - Math.cos(theta)) / Math.sin(theta);
        const actualVH = dShoulderYdiff / Math.abs(dShoulderXdiff);
        if (actualVH > expectedVH * FORWARD_FOLD_VH_RATIO_MAX) {
          this.currentRepForwardFoldFrames++;
        }
      }
    }

    this.checkNoMovement(now);
    this.advanceRepState(now);

    const frameMetrics: SideBendFrameMetrics = {
      leftLeanDeg: leftLift,
      rightLeanDeg: rightLift,
      smoothedLeftLift: this.smoothedLeftLift,
      smoothedRightLift: this.smoothedRightLift,
      repState: this.repState,
    };
    this.callbacks.onFrame?.(frameMetrics);
  }

  // ----------------------------------------------------------
  private advanceRepState(now: number): void {
    const sL = this.smoothedLeftLift;
    const sR = this.smoothedRightLift;
    const leftUp = sL > HIGH_THRESHOLD_DEG;
    const leftDown = sL < LOW_THRESHOLD_DEG;
    const rightUp = sR > HIGH_THRESHOLD_DEG;
    const rightDown = sR < LOW_THRESHOLD_DEG;

    switch (this.repState) {
      case 'UPRIGHT': {
        if (this.calConfirmedAt > 0 && now - this.calConfirmedAt < MIN_TIME_AFTER_CAL_MS) break;
        if (leftUp && sL > sR) {
          this.startRep('left', now);
          this.repState = 'LEFT_BENT';
          debugLog('SIDEBEND', 'STATE', 'UPRIGHT → LEFT_BENT', { left: +sL.toFixed(1) });
        } else if (rightUp && sR > sL) {
          this.startRep('right', now);
          this.repState = 'RIGHT_BENT';
          debugLog('SIDEBEND', 'STATE', 'UPRIGHT → RIGHT_BENT', { right: +sR.toFixed(1) });
        }
        break;
      }

      case 'LEFT_BENT':
        if (rightUp && sR > sL) {
          this.completeRep(now);
          this.startRep('right', now);
          this.repState = 'RIGHT_BENT';
          debugLog('SIDEBEND', 'STATE', 'LEFT_BENT → RIGHT_BENT', { right: +sR.toFixed(1) });
        } else if (leftDown && rightDown) {
          this.completeRep(now);
          this.repState = 'UPRIGHT';
          this.resetUprightTracking(now);
          debugLog('SIDEBEND', 'STATE', 'LEFT_BENT → UPRIGHT', {});
        }
        break;

      case 'RIGHT_BENT':
        if (leftUp && sL > sR) {
          this.completeRep(now);
          this.startRep('left', now);
          this.repState = 'LEFT_BENT';
          debugLog('SIDEBEND', 'STATE', 'RIGHT_BENT → LEFT_BENT', { left: +sL.toFixed(1) });
        } else if (leftDown && rightDown) {
          this.completeRep(now);
          this.repState = 'UPRIGHT';
          this.resetUprightTracking(now);
          debugLog('SIDEBEND', 'STATE', 'RIGHT_BENT → UPRIGHT', {});
        }
        break;
    }
  }

  private startRep(side: 'left' | 'right', now: number): void {
    this.resetRepBuffers();
    this.currentRepSide = side;
    this.currentRepStartedAt = now;
    this.prevShoulderMid = null;
  }

  private validateRepShape(now: number): { ok: true } | { ok: false; reason: string } {
    // Order: too-shallow → non-lateral (peak cap) → forward-fold → too-fast → ballistic.
    if (this.currentRepPeak < MIN_REP_LEAN_DEG) {
      return { ok: false, reason: 'too-shallow' };
    }
    if (this.currentRepPeak > MAX_PHYSIOLOGICAL_LEAN_DEG) {
      return { ok: false, reason: 'non-lateral' };
    }
    if (
      this.currentRepActiveFrames > 0
      && this.currentRepForwardFoldFrames / this.currentRepActiveFrames >= FORWARD_FOLD_VIOLATION_FRACTION
    ) {
      return { ok: false, reason: 'forward-fold' };
    }
    if (this.currentRepStartedAt > 0 && now - this.currentRepStartedAt < MIN_REP_DURATION_MS) {
      return { ok: false, reason: 'too-fast' };
    }
    if (this.currentRepShoulderVelocities.length > 0) {
      const peakV = Math.max(...this.currentRepShoulderVelocities.map(Math.abs));
      if (peakV > MAX_SHOULDER_VELOCITY) return { ok: false, reason: 'ballistic' };
    }
    return { ok: true };
  }

  private completeRep(now: number): void {
    if (this.currentRepSide === null) return;
    const side = this.currentRepSide;

    const validation = this.validateRepShape(now);
    if (!validation.ok) {
      const durationMs = this.currentRepStartedAt > 0 ? now - this.currentRepStartedAt : 0;
      debugLog('SIDEBEND', 'REJECT', 'Rep discarded', {
        reason: validation.reason,
        side,
        peak: +this.currentRepPeak.toFixed(1),
        durationMs: Math.round(durationMs),
      });
      if (validation.reason === 'too-fast' || validation.reason === 'ballistic') {
        this.maybeEmitWarning('malformed-rep', true, now);
      } else {
        // too-shallow / non-lateral / forward-fold → "do a proper full side bend"
        this.maybeEmitWarning('incomplete-bend', true, now);
      }
      this.currentRepSide = null;
      return;
    }

    const smoothness = getSmoothnessScore(this.currentRepShoulderVelocities);
    const form = 100; // no separate 2D torso-stability term — the torso IS the mover
    const completion = getCompletionScore(this.currentRepPeak);
    const mqs = computeMQS({ smoothness, form, completion });

    const repPayload = {
      depthDeg: Math.round(this.currentRepPeak * 10) / 10,
      smoothness: Math.round(smoothness),
      form,
      mqs: Math.round(mqs),
      side,
      warnings: Array.from(this.currentRepWarnings),
    };
    debugLog('SIDEBEND', 'REP', 'Rep complete', repPayload);
    this.callbacks.onRepComplete?.(repPayload);

    this.currentRepSide = null;
  }

  private resetUprightTracking(now: number): void {
    this.uprightSince = now;
    this.uprightMaxLiftMin = Infinity;
    this.uprightMaxLiftMax = -Infinity;
    this.uprightSettledSince = 0;
    this.uprightBaselineReseeded = false;
  }

  private checkNoMovement(now: number): void {
    if (this.repState !== 'UPRIGHT') {
      this.uprightSince = now;
      const maxLift = Math.max(this.smoothedLeftLift, this.smoothedRightLift);
      this.uprightMaxLiftMin = maxLift;
      this.uprightMaxLiftMax = maxLift;
      this.uprightSettledSince = 0;
      this.uprightBaselineReseeded = false;
      return;
    }
    const maxLift = Math.max(this.smoothedLeftLift, this.smoothedRightLift);
    if (maxLift < this.uprightMaxLiftMin) this.uprightMaxLiftMin = maxLift;
    if (maxLift > this.uprightMaxLiftMax) this.uprightMaxLiftMax = maxLift;
    // Fix O — post-rep EMA-decay reseed.
    if (!this.uprightBaselineReseeded) {
      const leftDelta = Math.abs(this.smoothedLeftLift - this.prevSmoothedLeftLift);
      const rightDelta = Math.abs(this.smoothedRightLift - this.prevSmoothedRightLift);
      const maxDelta = Math.max(leftDelta, rightDelta);
      if (maxDelta < SETTLED_DELTA_DEG) {
        if (this.uprightSettledSince === 0) this.uprightSettledSince = now;
        if (now - this.uprightSettledSince >= SETTLED_HOLD_MS) {
          this.uprightMaxLiftMin = maxLift;
          this.uprightMaxLiftMax = maxLift;
          this.uprightSince = now;
          this.uprightBaselineReseeded = true;
        }
      } else {
        this.uprightSettledSince = 0;
      }
    }
    const idleMs = now - this.uprightSince;
    const variance = this.uprightMaxLiftMax - this.uprightMaxLiftMin;
    // Fix P — cold-start cooldown.
    const firstFireAllowed = this.lastNoMovementWarnAt === 0
      || now - this.lastNoMovementWarnAt >= NO_MOVEMENT_REPEAT_MS;
    if (
      idleMs >= NO_MOVEMENT_TIMEOUT_MS
      && variance < NO_MOVEMENT_VARIANCE_DEG
      && firstFireAllowed
    ) {
      this.lastNoMovementWarnAt = now;
      debugLog('SIDEBEND', 'WARN', 'not-moving', {
        idleMs: Math.round(idleMs),
        variance: +variance.toFixed(2),
      });
      this.callbacks.onPostureWarning?.('not-moving');
      this.uprightSince = now;
      this.uprightMaxLiftMin = maxLift;
      this.uprightMaxLiftMax = maxLift;
      this.uprightSettledSince = 0;
      this.uprightBaselineReseeded = false;
    }
  }

  private resetRepBuffers(): void {
    this.currentRepSide = null;
    this.currentRepPeak = 0;
    this.currentRepStartedAt = 0;
    this.currentRepShoulderVelocities = [];
    this.currentRepWarnings = new Set();
    this.prevShoulderMid = null;
    this.currentRepActiveFrames = 0;
    this.currentRepForwardFoldFrames = 0;
  }

  private maybeEmitWarning(type: WarningType, active: boolean, now: number): void {
    if (!active) return;
    const last = this.warningCooldowns[type] ?? 0;
    if (now - last < WARNING_REPEAT_COOLDOWN_MS) return;
    this.warningCooldowns[type] = now;
    debugLog('SIDEBEND', 'WARN', type);
    this.callbacks.onPostureWarning?.(type);
  }

  // ----------------------------------------------------------
  // Fix N — position-lost detection
  // ----------------------------------------------------------
  private hasCoreLandmarks(landmarks: PoseLandmarks): boolean {
    return lmVisible(landmarks[LM.LEFT_SHOULDER]) && lmVisible(landmarks[LM.RIGHT_SHOULDER])
      && lmVisible(landmarks[LM.LEFT_HIP])      && lmVisible(landmarks[LM.RIGHT_HIP])
      && lmVisible(landmarks[LM.LEFT_KNEE])     && lmVisible(landmarks[LM.RIGHT_KNEE])
      && lmVisible(landmarks[LM.LEFT_ANKLE])    && lmVisible(landmarks[LM.RIGHT_ANKLE]);
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
    debugLog('SIDEBEND', 'WARN', 'position-lost', { lostMs: Math.round(lostMs) });
    this.callbacks.onPostureWarning?.('position-lost');
  }

  static readonly MIN_SHOULDER_WIDTH_RUNTIME = MIN_SHOULDER_WIDTH_RUNTIME;
}
