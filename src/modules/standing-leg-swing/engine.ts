/**
 * StandingLegSwingEngine — front-camera, rep-based, per-side lateral leg swing.
 *
 * Stand facing the camera and swing one leg out to the side and back in a
 * rhythmic, dynamic motion (one side repeatedly, or alternating). It is the
 * faster, dynamic cousin of the Standing Side Leg Raise, so it reuses that
 * module wholesale — the same per-side hip-abduction geometry, the same
 * calibration (standing ready, both legs down), the same 3-state machine, the
 * same scoring, and the same baseline/frame/callback types.
 *
 * The ONLY differences vs SideLegRaiseEngine are tempo tolerances: a swing is
 * faster and more ballistic than a slow controlled raise, so the minimum rep
 * duration is shorter and the ankle-velocity ceiling is higher (clean swings
 * never trip the malformed-rep gate).
 *
 * Posture warnings (ALL reused — no new warning types):
 *   - `low-leg-raise`  — swing peaked below MIN_REP_ABDUCTION_DEG (barely out)
 *   - `malformed-rep`  — too-fast (< 200 ms) or ballistic (ankle velocity ceiling)
 *   - `not-moving`     — 5 s idle standing (Fix I/O/P)
 *   - `position-lost`  — no usable pose frame for ≥ 3 s post-cal (Fix N)
 * `torso-swing` feeds the form score only (not emitted) — swinging a leg
 * naturally shifts weight onto the standing leg.
 */
import type { PoseLandmarks } from '@/modules/pose/types';
import type { WarningType } from '@/store/workout';
import {
  LM, lmVisible, MIN_SHOULDER_WIDTH_RUNTIME, legAbductionDeg, clampAbductionDelta,
} from '@/modules/side-leg-raise/geometry';
import { SideLegRaiseCalibration } from '@/modules/side-leg-raise/calibration';
import type {
  SideLegRaiseBaseline, SideLegRaiseEngineCallbacks, SideLegRaiseFrameMetrics, SideLegRaiseRepState,
} from '@/modules/side-leg-raise/types';
import { computeMQS, getCompletionScore, getFormScore, getSmoothnessScore } from '@/modules/side-leg-raise/scoring';
import { debugLog } from '@/lib/debug';

const EMA_ALPHA_ABD = 0.30;

const HIGH_THRESHOLD_DEG = 15;
const LOW_THRESHOLD_DEG = 8;
// A swing clearly throws the leg out to the side; 22° is a deliberate swing.
const MIN_REP_ABDUCTION_DEG = 22;
const MIN_TIME_AFTER_CAL_MS = 500;
const MAX_REASONABLE_ABDUCTION_DEG = 70;

const TORSO_SWING_THRESHOLD = 0.04;
const TORSO_SWING_DEBOUNCE_FRAMES = 8;
const WARNING_REPEAT_COOLDOWN_MS = 2500;

const NO_MOVEMENT_TIMEOUT_MS = 5000;
const NO_MOVEMENT_VARIANCE_DEG = 2.0;
const NO_MOVEMENT_REPEAT_MS = 15000;
const SETTLED_DELTA_DEG = 0.5;
const SETTLED_HOLD_MS = 500;

const POSITION_LOST_TIMEOUT_MS = 3000;
const POSITION_LOST_REPEAT_MS = 10_000;

// Tempo tolerances — looser than the side leg RAISE: a swing is a faster,
// rhythmic movement, so allow a shorter minimum duration and a higher ballistic
// ankle-velocity ceiling (clean swings stay under it).
const MIN_REP_DURATION_MS = 200;
const MAX_ANKLE_VELOCITY = 8.0;

export class StandingLegSwingEngine {
  private callbacks: SideLegRaiseEngineCallbacks;
  private calibration: SideLegRaiseCalibration;
  private baseline: SideLegRaiseBaseline | null = null;

  private repState: SideLegRaiseRepState = 'BOTH_DOWN';

  private smoothedLeftAbd = 0;
  private smoothedRightAbd = 0;
  private abdSeeded = false;

  private smoothedLeftLift = 0;
  private smoothedRightLift = 0;
  private prevSmoothedLeftLift = 0;
  private prevSmoothedRightLift = 0;

  private currentRepSide: 'left' | 'right' | null = null;
  private currentRepPeak = 0;
  private currentRepStartedAt = 0;
  private currentRepAnkleVelocities: number[] = [];
  private currentRepFormCounts = { torsoOKCount: 0, totalCount: 0 };
  private currentRepWarnings: Set<WarningType> = new Set();
  private prevActiveAnkle: { x: number; y: number } | null = null;
  private prevSampleTimestamp = 0;

  private bothDownSince = 0;
  private bothDownMaxLiftMin = Infinity;
  private bothDownMaxLiftMax = -Infinity;
  private lastNoMovementWarnAt = 0;
  private bothDownSettledSince = 0;
  private bothDownBaselineReseeded = false;

  private lastValidFrameAt = 0;
  private lastPositionLostWarnAt = 0;

  private calConfirmedAt = 0;

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
          this.smoothedLeftAbd = this.baseline.baselineLeftAbductionDeg;
          this.smoothedRightAbd = this.baseline.baselineRightAbductionDeg;
          this.abdSeeded = true;
          this.smoothedLeftLift = 0;
          this.smoothedRightLift = 0;
          this.prevSmoothedLeftLift = 0;
          this.prevSmoothedRightLift = 0;
          this.bothDownSince = now;
          this.bothDownMaxLiftMin = 0;
          this.bothDownMaxLiftMax = 0;
          this.lastValidFrameAt = now;
          this.calConfirmedAt = now;
          debugLog('LEGSWING', 'CALIB', 'CONFIRMED', {
            shoulderWidth: +this.baseline.shoulderWidth.toFixed(3),
            leftAbd: +this.baseline.baselineLeftAbductionDeg.toFixed(1),
            rightAbd: +this.baseline.baselineRightAbductionDeg.toFixed(1),
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
    const lh = landmarks[LM.LEFT_HIP];
    const rh = landmarks[LM.RIGHT_HIP];
    const la = landmarks[LM.LEFT_ANKLE];
    const ra = landmarks[LM.RIGHT_ANKLE];

    const coreOk = lmVisible(ls) && lmVisible(rs) && lmVisible(lh) && lmVisible(rh)
      && lmVisible(la) && lmVisible(ra);
    if (!coreOk) return;

    const rawLeftAbd = legAbductionDeg(lh, la);
    const rawRightAbd = legAbductionDeg(rh, ra);

    const clampedLeft = this.abdSeeded ? clampAbductionDelta(rawLeftAbd, this.smoothedLeftAbd) : rawLeftAbd;
    const clampedRight = this.abdSeeded ? clampAbductionDelta(rawRightAbd, this.smoothedRightAbd) : rawRightAbd;
    this.smoothedLeftAbd = this.abdSeeded
      ? EMA_ALPHA_ABD * clampedLeft + (1 - EMA_ALPHA_ABD) * this.smoothedLeftAbd
      : clampedLeft;
    this.smoothedRightAbd = this.abdSeeded
      ? EMA_ALPHA_ABD * clampedRight + (1 - EMA_ALPHA_ABD) * this.smoothedRightAbd
      : clampedRight;
    this.abdSeeded = true;

    const leftLift = rawLeftAbd - baseline.baselineLeftAbductionDeg;
    const rightLift = rawRightAbd - baseline.baselineRightAbductionDeg;

    this.prevSmoothedLeftLift = this.smoothedLeftLift;
    this.prevSmoothedRightLift = this.smoothedRightLift;
    this.smoothedLeftLift = this.smoothedLeftAbd - baseline.baselineLeftAbductionDeg;
    this.smoothedRightLift = this.smoothedRightAbd - baseline.baselineRightAbductionDeg;

    if (this.prevSampleTimestamp > 0 && this.currentRepSide !== null && this.prevActiveAnkle) {
      const dt = (now - this.prevSampleTimestamp) / 1000;
      if (dt > 0) {
        const activeAnkle = this.currentRepSide === 'left' ? la : ra;
        const v = Math.hypot(activeAnkle.x - this.prevActiveAnkle.x, activeAnkle.y - this.prevActiveAnkle.y) / dt;
        this.currentRepAnkleVelocities.push(v);
      }
    }
    if (this.currentRepSide !== null) {
      const activeAnkle = this.currentRepSide === 'left' ? la : ra;
      this.prevActiveAnkle = { x: activeAnkle.x, y: activeAnkle.y };
    }
    this.prevSampleTimestamp = now;

    const shoulderMidX = (ls.x + rs.x) / 2;
    const torsoSwingActive = Math.abs(shoulderMidX - baseline.shoulderMidX) > TORSO_SWING_THRESHOLD;
    this.torsoSwingFrames = torsoSwingActive ? this.torsoSwingFrames + 1 : 0;
    const torsoSwingWarn = this.torsoSwingFrames >= TORSO_SWING_DEBOUNCE_FRAMES;

    if (this.repState !== 'BOTH_DOWN') {
      this.currentRepFormCounts.totalCount++;
      if (!torsoSwingWarn) this.currentRepFormCounts.torsoOKCount++;
    }
    if (torsoSwingWarn) this.currentRepWarnings.add('torso-swing');

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
        if (this.calConfirmedAt > 0 && now - this.calConfirmedAt < MIN_TIME_AFTER_CAL_MS) break;
        if (leftUp && sL > sR) {
          this.startRep('left', now);
          this.repState = 'LEFT_UP';
          debugLog('LEGSWING', 'STATE', 'BOTH_DOWN → LEFT_UP', { left: +sL.toFixed(1) });
        } else if (rightUp && sR > sL) {
          this.startRep('right', now);
          this.repState = 'RIGHT_UP';
          debugLog('LEGSWING', 'STATE', 'BOTH_DOWN → RIGHT_UP', { right: +sR.toFixed(1) });
        }
        break;
      }

      case 'LEFT_UP':
        if (rightUp && sR > sL) {
          this.completeRep(now);
          this.startRep('right', now);
          this.repState = 'RIGHT_UP';
          debugLog('LEGSWING', 'STATE', 'LEFT_UP → RIGHT_UP', { right: +sR.toFixed(1) });
        } else if (leftDown && rightDown) {
          this.completeRep(now);
          this.repState = 'BOTH_DOWN';
          this.resetBothDownTracking(now);
          debugLog('LEGSWING', 'STATE', 'LEFT_UP → BOTH_DOWN', {});
        }
        break;

      case 'RIGHT_UP':
        if (leftUp && sL > sR) {
          this.completeRep(now);
          this.startRep('left', now);
          this.repState = 'LEFT_UP';
          debugLog('LEGSWING', 'STATE', 'RIGHT_UP → LEFT_UP', { left: +sL.toFixed(1) });
        } else if (leftDown && rightDown) {
          this.completeRep(now);
          this.repState = 'BOTH_DOWN';
          this.resetBothDownTracking(now);
          debugLog('LEGSWING', 'STATE', 'RIGHT_UP → BOTH_DOWN', {});
        }
        break;
    }
  }

  private startRep(side: 'left' | 'right', now: number): void {
    this.resetRepBuffers();
    this.currentRepSide = side;
    this.currentRepStartedAt = now;
    this.prevActiveAnkle = null;
  }

  private validateRepShape(now: number): { ok: true } | { ok: false; reason: string } {
    if (this.currentRepPeak < MIN_REP_ABDUCTION_DEG) {
      return { ok: false, reason: 'too-shallow' };
    }
    if (this.currentRepStartedAt > 0 && now - this.currentRepStartedAt < MIN_REP_DURATION_MS) {
      return { ok: false, reason: 'too-fast' };
    }
    if (this.currentRepAnkleVelocities.length > 0) {
      const peakV = Math.max(...this.currentRepAnkleVelocities.map(Math.abs));
      if (peakV > MAX_ANKLE_VELOCITY) return { ok: false, reason: 'ballistic' };
    }
    return { ok: true };
  }

  private completeRep(now: number): void {
    if (this.currentRepSide === null) return;
    const side = this.currentRepSide;

    const validation = this.validateRepShape(now);
    if (!validation.ok) {
      const durationMs = this.currentRepStartedAt > 0 ? now - this.currentRepStartedAt : 0;
      debugLog('LEGSWING', 'REJECT', 'Rep discarded', {
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

    const smoothness = getSmoothnessScore(this.currentRepAnkleVelocities);
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
    debugLog('LEGSWING', 'REP', 'Rep complete', repPayload);
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
    const firstFireAllowed = this.lastNoMovementWarnAt === 0
      || now - this.lastNoMovementWarnAt >= NO_MOVEMENT_REPEAT_MS;
    if (
      idleMs >= NO_MOVEMENT_TIMEOUT_MS
      && variance < NO_MOVEMENT_VARIANCE_DEG
      && firstFireAllowed
    ) {
      this.lastNoMovementWarnAt = now;
      debugLog('LEGSWING', 'WARN', 'not-moving', {
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
    this.currentRepAnkleVelocities = [];
    this.currentRepFormCounts = { torsoOKCount: 0, totalCount: 0 };
    this.currentRepWarnings = new Set();
    this.torsoSwingFrames = 0;
    this.prevActiveAnkle = null;
  }

  private maybeEmitWarning(type: WarningType, active: boolean, now: number): void {
    if (!active) return;
    const last = this.warningCooldowns[type] ?? 0;
    if (now - last < WARNING_REPEAT_COOLDOWN_MS) return;
    this.warningCooldowns[type] = now;
    debugLog('LEGSWING', 'WARN', type);
    this.callbacks.onPostureWarning?.(type);
  }

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
    debugLog('LEGSWING', 'WARN', 'position-lost', { lostMs: Math.round(lostMs) });
    this.callbacks.onPostureWarning?.('position-lost');
  }

  static readonly MIN_SHOULDER_WIDTH_RUNTIME = MIN_SHOULDER_WIDTH_RUNTIME;
}
