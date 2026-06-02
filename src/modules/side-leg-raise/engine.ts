/**
 * SideLegRaiseEngine — front-camera, rep-based, per-side hip abduction.
 *
 * Stand facing the camera; lift one leg out to the side (frontal plane), lower,
 * repeat — on one side or alternating. Cloned from HighKneesEngine: identical
 * 3-state per-side machine, but the tracked metric is LEG ABDUCTION ANGLE
 * (lateral, image plane) instead of vertical knee-lift %. Abduction lift is
 * measured relative to each leg's standing baseline angle.
 *
 * State transitions (per side, hysteresis HIGH=15° vs LOW=8°):
 *   BOTH_DOWN → LEFT_UP   : smoothedLeftLift > HIGH AND it leads the right
 *   LEFT_UP   → RIGHT_UP  : right now leads past HIGH (finalizes left rep)
 *   LEFT_UP   → BOTH_DOWN : both lifts < LOW (finalizes left rep)
 *   (RIGHT_UP mirrored)
 *
 * Posture warnings:
 *   - `low-leg-raise`  — rep complete but peak abduction lift < MIN_REP_ABDUCTION_DEG
 *   - `malformed-rep`  — too-fast (< 300 ms) or ballistic (knee > MAX_KNEE_VELOCITY)
 *   - `not-moving`     — 5 s idle in BOTH_DOWN (Fix I/O/P)
 *   - `position-lost`  — no usable pose frame for ≥ 3 s post-cal (Fix N)
 *
 * `torso-swing` is tracked for the form score but NOT emitted as a chip/voice
 * cue: lifting a leg naturally shifts weight (and shoulder-mid X) onto the
 * standing leg, so emitting it would false-positive (mirrors high-knees /
 * lateral-raise after physical testing).
 */
import type { PoseLandmarks } from '@/modules/pose/types';
import type { WarningType } from '@/store/workout';
import {
  LM, lmVisible, MIN_SHOULDER_WIDTH_RUNTIME, legAbductionDeg, clampAbductionDelta,
} from './geometry';
import { SideLegRaiseCalibration } from './calibration';
import type {
  SideLegRaiseBaseline, SideLegRaiseEngineCallbacks, SideLegRaiseFrameMetrics, SideLegRaiseRepState,
} from './types';
import { computeMQS, getCompletionScore, getSmoothnessScore } from './scoring';
import { debugLog } from '@/lib/debug';

const EMA_ALPHA_ABD = 0.30;

// State-machine thresholds (degrees of abduction lift above standing baseline).
// Hysteresis gap = 7. Entering UP at 15° starts rep tracking; the rep must peak
// at MIN_REP_ABDUCTION_DEG to validate (a low bar to enter, a higher bar to count).
const HIGH_THRESHOLD_DEG = 15;
const LOW_THRESHOLD_DEG = 8;
// Valid-rep peak floor. Standing hip-abduction ROM is ~0–45°; 22° is a clearly
// deliberate raise (leg well out to the side). Below this → low-leg-raise.
const MIN_REP_ABDUCTION_DEG = 22;
// Post-cal grace so noisy first-frame EMA seeds can't fire a ghost rep.
const MIN_TIME_AFTER_CAL_MS = 500;
// Cap raw per-rep peak. 2026-05-31 physical-test fix: lowered 70→52. Standing
// hip-abduction ROM is ~0–45°; the metric also inflates a little from pelvic
// drop on the stance side, so 52 keeps the displayed depth realistic. Reps
// still count (the floor is MIN_REP_ABDUCTION_DEG); this only caps the number.
const MAX_REASONABLE_ABDUCTION_DEG = 52;

const TORSO_SWING_THRESHOLD = 0.04;
const TORSO_SWING_DEBOUNCE_FRAMES = 8;
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

// Rep shape (Fix D order: too-shallow → too-fast → ballistic). Side leg raise is
// a controlled movement. 2026-05-31 physical-test fix: the velocity sample now
// uses the KNEE (positionally far more stable than the ankle, which jittered
// past 5 nu/s on normal-speed reps and caused constant false 'ballistic'
// rejections). Ceiling raised to 6 for extra headroom — clean reps never trip it.
const MIN_REP_DURATION_MS = 300;
const MAX_KNEE_VELOCITY = 6.0;   // nu/sec — knee is far less noisy than the ankle

export class SideLegRaiseEngine {
  private callbacks: SideLegRaiseEngineCallbacks;
  private calibration: SideLegRaiseCalibration;
  private baseline: SideLegRaiseBaseline | null = null;

  private repState: SideLegRaiseRepState = 'BOTH_DOWN';

  // Per-side EMA-smoothed abduction angle. Seeded on first post-cal frame.
  private smoothedLeftAbd = 0;
  private smoothedRightAbd = 0;
  private abdSeeded = false;

  // Per-side smoothed lift (smoothed abduction − baseline) + previous-frame value
  // for EMA-decay-tail tracking.
  private smoothedLeftLift = 0;
  private smoothedRightLift = 0;
  private prevSmoothedLeftLift = 0;
  private prevSmoothedRightLift = 0;

  // Active rep tracking (one at a time).
  private currentRepSide: 'left' | 'right' | null = null;
  private currentRepPeak = 0;
  private currentRepStartedAt = 0;
  private currentRepKneeVelocities: number[] = [];
  private currentRepFormCounts = { torsoOKCount: 0, totalCount: 0 };
  private currentRepWarnings: Set<WarningType> = new Set();
  private prevActiveKnee: { x: number; y: number } | null = null;
  private prevSampleTimestamp = 0;

  // Idle detection (BOTH_DOWN). Tracks variance of max(left, right) lift.
  private bothDownSince = 0;
  private bothDownMaxLiftMin = Infinity;
  private bothDownMaxLiftMax = -Infinity;
  private lastNoMovementWarnAt = 0;
  // Fix O — post-rep EMA-decay reseed flags.
  private bothDownSettledSince = 0;
  private bothDownBaselineReseeded = false;

  // Position-lost detection (Fix N)
  private lastValidFrameAt = 0;
  private lastPositionLostWarnAt = 0;

  // Post-cal grace timestamp (ghost-rep prevention).
  private calConfirmedAt = 0;

  // Posture debounce
  private torsoSwingFrames = 0;

  private warningCooldowns: Partial<Record<WarningType, number>> = {};
  private finished = false;

  constructor(callbacks: SideLegRaiseEngineCallbacks = {}) {
    this.callbacks = callbacks;
    this.calibration = new SideLegRaiseCalibration();
  }

  update(landmarks: PoseLandmarks | null, now: number): void {
    if (this.finished) return;

    if (!this.calibration.isConfirmed()) {
      const calUpdate = this.calibration.update(landmarks, now);
      this.callbacks.onCalibrationUpdate?.(calUpdate);
      if (calUpdate.state === 'confirmed') {
        this.baseline = this.calibration.getBaseline();
        if (this.baseline) {
          // Seed smoothed abduction from per-side baseline (lift starts at 0).
          this.smoothedLeftAbd = this.baseline.baselineLeftAbductionDeg;
          this.smoothedRightAbd = this.baseline.baselineRightAbductionDeg;
          this.abdSeeded = true;
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
          debugLog('LEGRAISE', 'CALIB', 'CONFIRMED', {
            shoulderWidth: +this.baseline.shoulderWidth.toFixed(3),
            leftAbd: +this.baseline.baselineLeftAbductionDeg.toFixed(1),
            rightAbd: +this.baseline.baselineRightAbductionDeg.toFixed(1),
          });
        }
      }
      return;
    }

    // Position-lost runs regardless of usable frames.
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
    const lh = landmarks[LM.LEFT_HIP];
    const rh = landmarks[LM.RIGHT_HIP];
    const lk = landmarks[LM.LEFT_KNEE];
    const rk = landmarks[LM.RIGHT_KNEE];
    const la = landmarks[LM.LEFT_ANKLE];
    const ra = landmarks[LM.RIGHT_ANKLE];

    const coreOk = lmVisible(ls) && lmVisible(rs) && lmVisible(lh) && lmVisible(rh)
      && lmVisible(lk) && lmVisible(rk) && lmVisible(la) && lmVisible(ra);
    if (!coreOk) return;

    // Per-frame raw abduction angle per side.
    const rawLeftAbd = legAbductionDeg(lh, la);
    const rawRightAbd = legAbductionDeg(rh, ra);

    // Clamp against previous smoothed, then EMA (outlier suppression for the
    // noisy ankle landmark).
    const clampedLeft = this.abdSeeded ? clampAbductionDelta(rawLeftAbd, this.smoothedLeftAbd) : rawLeftAbd;
    const clampedRight = this.abdSeeded ? clampAbductionDelta(rawRightAbd, this.smoothedRightAbd) : rawRightAbd;
    this.smoothedLeftAbd = this.abdSeeded
      ? EMA_ALPHA_ABD * clampedLeft + (1 - EMA_ALPHA_ABD) * this.smoothedLeftAbd
      : clampedLeft;
    this.smoothedRightAbd = this.abdSeeded
      ? EMA_ALPHA_ABD * clampedRight + (1 - EMA_ALPHA_ABD) * this.smoothedRightAbd
      : clampedRight;
    this.abdSeeded = true;

    // Per-side raw lift (degrees above standing baseline).
    const leftLift = rawLeftAbd - baseline.baselineLeftAbductionDeg;
    const rightLift = rawRightAbd - baseline.baselineRightAbductionDeg;

    // Per-side smoothed lift — drives the state machine.
    this.prevSmoothedLeftLift = this.smoothedLeftLift;
    this.prevSmoothedRightLift = this.smoothedRightLift;
    this.smoothedLeftLift = this.smoothedLeftAbd - baseline.baselineLeftAbductionDeg;
    this.smoothedRightLift = this.smoothedRightAbd - baseline.baselineRightAbductionDeg;

    // Velocity sampling — active-side KNEE position velocity (nu/sec). The knee
    // is far less noisy than the ankle, which spiked past the ballistic ceiling
    // on normal-speed reps in physical testing.
    if (this.prevSampleTimestamp > 0 && this.currentRepSide !== null && this.prevActiveKnee) {
      const dt = (now - this.prevSampleTimestamp) / 1000;
      if (dt > 0) {
        const activeKnee = this.currentRepSide === 'left' ? lk : rk;
        const v = Math.hypot(activeKnee.x - this.prevActiveKnee.x, activeKnee.y - this.prevActiveKnee.y) / dt;
        this.currentRepKneeVelocities.push(v);
      }
    }
    if (this.currentRepSide !== null) {
      const activeKnee = this.currentRepSide === 'left' ? lk : rk;
      this.prevActiveKnee = { x: activeKnee.x, y: activeKnee.y };
    }
    this.prevSampleTimestamp = now;

    // Torso swing — shoulder-mid X drift from baseline (form score only; not emitted).
    const shoulderMidX = (ls.x + rs.x) / 2;
    const torsoSwingActive = Math.abs(shoulderMidX - baseline.shoulderMidX) > TORSO_SWING_THRESHOLD;
    this.torsoSwingFrames = torsoSwingActive ? this.torsoSwingFrames + 1 : 0;
    const torsoSwingWarn = this.torsoSwingFrames >= TORSO_SWING_DEBOUNCE_FRAMES;

    // Form accumulation during active phases.
    if (this.repState !== 'BOTH_DOWN') {
      this.currentRepFormCounts.totalCount++;
      if (!torsoSwingWarn) this.currentRepFormCounts.torsoOKCount++;
    }
    if (torsoSwingWarn) this.currentRepWarnings.add('torso-swing');

    // Per-rep peak uses RAW lift (not smoothed) so EMA lag doesn't shave the
    // validated peak — same pattern as high-knees. Clamp outliers.
    if (this.currentRepSide === 'left') {
      const clamped = Math.min(leftLift, MAX_REASONABLE_ABDUCTION_DEG);
      if (clamped > this.currentRepPeak) this.currentRepPeak = clamped;
    } else if (this.currentRepSide === 'right') {
      const clamped = Math.min(rightLift, MAX_REASONABLE_ABDUCTION_DEG);
      if (clamped > this.currentRepPeak) this.currentRepPeak = clamped;
    }

    this.checkNoMovement(now);
    this.advanceRepState(now);

    const frameMetrics: SideLegRaiseFrameMetrics = {
      leftAbductionDeg: leftLift,
      rightAbductionDeg: rightLift,
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
    const leftUp = sL > HIGH_THRESHOLD_DEG;
    const leftDown = sL < LOW_THRESHOLD_DEG;
    const rightUp = sR > HIGH_THRESHOLD_DEG;
    const rightDown = sR < LOW_THRESHOLD_DEG;

    switch (this.repState) {
      case 'BOTH_DOWN': {
        // Post-cal grace period — suppress UP transitions so noisy first-frame
        // EMA seeds can't trigger a ghost rep before the user has lifted.
        if (this.calConfirmedAt > 0 && now - this.calConfirmedAt < MIN_TIME_AFTER_CAL_MS) break;
        if (leftUp && sL > sR) {
          this.startRep('left', now);
          this.repState = 'LEFT_UP';
          debugLog('LEGRAISE', 'STATE', 'BOTH_DOWN → LEFT_UP', { left: +sL.toFixed(1) });
        } else if (rightUp && sR > sL) {
          this.startRep('right', now);
          this.repState = 'RIGHT_UP';
          debugLog('LEGRAISE', 'STATE', 'BOTH_DOWN → RIGHT_UP', { right: +sR.toFixed(1) });
        }
        break;
      }

      case 'LEFT_UP':
        if (rightUp && sR > sL) {
          this.completeRep(now);
          this.startRep('right', now);
          this.repState = 'RIGHT_UP';
          debugLog('LEGRAISE', 'STATE', 'LEFT_UP → RIGHT_UP', { right: +sR.toFixed(1) });
        } else if (leftDown && rightDown) {
          this.completeRep(now);
          this.repState = 'BOTH_DOWN';
          this.resetBothDownTracking(now);
          debugLog('LEGRAISE', 'STATE', 'LEFT_UP → BOTH_DOWN', {});
        }
        break;

      case 'RIGHT_UP':
        if (leftUp && sL > sR) {
          this.completeRep(now);
          this.startRep('left', now);
          this.repState = 'LEFT_UP';
          debugLog('LEGRAISE', 'STATE', 'RIGHT_UP → LEFT_UP', { left: +sL.toFixed(1) });
        } else if (leftDown && rightDown) {
          this.completeRep(now);
          this.repState = 'BOTH_DOWN';
          this.resetBothDownTracking(now);
          debugLog('LEGRAISE', 'STATE', 'RIGHT_UP → BOTH_DOWN', {});
        }
        break;
    }
  }

  private startRep(side: 'left' | 'right', now: number): void {
    // Fix C: reset BEFORE setting timestamp.
    this.resetRepBuffers();
    this.currentRepSide = side;
    this.currentRepStartedAt = now;
    this.prevActiveKnee = null;
  }

  private validateRepShape(now: number): { ok: true } | { ok: false; reason: string } {
    // Fix D: too-shallow → too-fast → ballistic.
    if (this.currentRepPeak < MIN_REP_ABDUCTION_DEG) {
      return { ok: false, reason: 'too-shallow' };
    }
    if (this.currentRepStartedAt > 0 && now - this.currentRepStartedAt < MIN_REP_DURATION_MS) {
      return { ok: false, reason: 'too-fast' };
    }
    if (this.currentRepKneeVelocities.length > 0) {
      const peakV = Math.max(...this.currentRepKneeVelocities.map(Math.abs));
      if (peakV > MAX_KNEE_VELOCITY) return { ok: false, reason: 'ballistic' };
    }
    return { ok: true };
  }

  private completeRep(now: number): void {
    if (this.currentRepSide === null) return;
    const side = this.currentRepSide;

    const validation = this.validateRepShape(now);
    if (!validation.ok) {
      const durationMs = this.currentRepStartedAt > 0 ? now - this.currentRepStartedAt : 0;
      debugLog('LEGRAISE', 'REJECT', 'Rep discarded', {
        reason: validation.reason,
        side,
        peak: +this.currentRepPeak.toFixed(1),
        durationMs: Math.round(durationMs),
      });
      if (validation.reason === 'too-shallow') {
        this.maybeEmitWarning('low-leg-raise', true, now);
      } else {
        this.maybeEmitWarning('malformed-rep', true, now);
      }
      this.currentRepSide = null;
      return;
    }

    const smoothness = getSmoothnessScore(this.currentRepKneeVelocities);
    // 2026-05-31 physical-test fix: form = 100 (no torso-swing penalty). The
    // weight-shift onto the standing leg is biomechanically unavoidable and was
    // tanking the score to 3–8. torso-swing is still tracked but never emitted.
    const form = 100;
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
    debugLog('LEGRAISE', 'REP', 'Rep complete', repPayload);
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
      if (maxDelta < SETTLED_DELTA_DEG) {
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
      && variance < NO_MOVEMENT_VARIANCE_DEG
      && firstFireAllowed
    ) {
      this.lastNoMovementWarnAt = now;
      debugLog('LEGRAISE', 'WARN', 'not-moving', {
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
    this.prevActiveKnee = null;
  }

  private maybeEmitWarning(type: WarningType, active: boolean, now: number): void {
    if (!active) return;
    const last = this.warningCooldowns[type] ?? 0;
    if (now - last < WARNING_REPEAT_COOLDOWN_MS) return;
    this.warningCooldowns[type] = now;
    debugLog('LEGRAISE', 'WARN', type);
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
    debugLog('LEGRAISE', 'WARN', 'position-lost', { lostMs: Math.round(lostMs) });
    this.callbacks.onPostureWarning?.('position-lost');
  }

  static readonly MIN_SHOULDER_WIDTH_RUNTIME = MIN_SHOULDER_WIDTH_RUNTIME;
}
