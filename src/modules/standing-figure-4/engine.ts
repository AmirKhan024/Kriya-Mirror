/**
 * StandingFigure4Engine — hold-based balance tracker for the Standing Figure-4
 * (standing pigeon): stand on one leg, cross the other ankle over the standing
 * knee, sink into a mini-squat, hold.
 *
 * Clones TreePoseEngine almost verbatim — geometrically it is the same
 * single-leg balance + "free foot on the standing leg" problem (here the
 * crossed ankle rests at the standing knee). Same hold lifecycle, CoM-proxy
 * sway (Fix Z 12°), Fix V hysteresis on every warning, Fix S recoverable
 * form-break (freeze, don't terminate), Fix U longest-streak, Fix N
 * position-lost, round-20 not-moving idle nudge.
 *
 * ADDED vs Tree Pose: an engine-local runtime distance monitor that nudges
 * too-far / too-close DURING the hold (owner request), with cold-start
 * sentinels so the first nudge isn't swallowed by its cooldown.
 *
 * Form warnings (all reuse existing WarningTypes):
 *   - `swaying`      — CoM sway past 12° (recoverable freeze).
 *   - `foot-off-leg` — crossed ankle X drifts off the standing-knee X (freeze).
 *   - `hip-tilted`   — crossed-side hip drops (freeze).
 *   - `foot-dropped` — crossed leg lowered back to the floor (freeze).
 *   - `not-moving`   — out of pose ≥ 5 s (idle nudge).
 *   - `too-far` / `too-close` — runtime distance nudges.
 *   - `position-lost`/`hold-broken` — cross-cutting.
 * Only `shoulder-rise` (user stood fully up) terminates the hold.
 */
import type { NormalizedLandmark, PoseLandmarks } from '@/modules/pose/types';
import type { WarningType } from '@/store/workout';
import { LM, lmVisible, comProxy } from './geometry';
import { StandingFigure4Calibration } from './calibration';
import type { Figure4Baseline, Figure4EngineCallbacks, Figure4FrameMetrics } from './types';
import { getFootOffLegPenalty, getHipTiltPenalty, getSwayPenalty } from './scoring';
import { debugLog } from '@/lib/debug';

const SMOOTHING_ALPHA = 0.20;
const HOLD_BASELINE_FRAMES = 30;

// Real-world single-leg holds wobble more than the lab estimate (physical
// test: 12° froze correct holds) → 16°.
const SWAY_WARN_ANGLE_DEG = 16;
const SWAY_WARN_FRAMES = 6;
const SWAY_RESUME_FRAMES = 6;

const HIP_TILT_RATIO = 0.22;
const HIP_TILT_DEBOUNCE_FRAMES = 6;
const HIP_TILT_RESUME_FRAMES = 6;

// Crossed ankle X must stay within this tolerance of the standing-knee X.
const FOOT_ON_LEG_X_TOLERANCE = 0.12;
const FOOT_OFF_LEG_DEBOUNCE_FRAMES = 6;
const FOOT_OFF_LEG_RESUME_FRAMES = 6;

const FOOT_DROPPED_RATIO = 0.05;
const FOOT_DROPPED_KNEE_RATIO = 0.12;
const FOOT_DROPPED_DEBOUNCE_FRAMES = 8;
const FOOT_DROPPED_RESUME_FRAMES = 8;

// Terminal "stood up" margin + debounce: only end on a SUSTAINED rise so a
// momentary wobble never terminates the hold.
const HOLD_BROKEN_SHOULDER_RISE = 0.18;
const SHOULDER_RISE_DEBOUNCE_FRAMES = 18;   // ~0.6 s sustained

// Form-break grace + forgiving escalation (see star-pose for the rationale).
const HOLD_START_GRACE_MS = 1500;
const FORM_BREAK_END_CONTINUOUS_MS = 7000;
const FORM_BREAK_END_COUNT = 5;

const FORM_SMOOTH_ALPHA = 0.15;
const TICK_INTERVAL_MS = 1000;
// Slower re-fire so a lingering condition doesn't machine-gun the same nudge.
const WARNING_REPEAT_COOLDOWN_MS = 6000;

const POSITION_LOST_TIMEOUT_MS = 3000;
const POSITION_LOST_REPEAT_MS = 10_000;

const NOT_MOVING_TIMEOUT_MS = 5000;
const NOT_MOVING_REPEAT_MS = 15_000;

const MIN_STREAK_BREAK_MS = 1000;
// Clamp the sway-normalization denominator so a FAR user's tiny shoulderWidth
// (physical test: 0.099) doesn't over-amplify sway and freeze a correct hold.
const MIN_SHOULDER_WIDTH_RUNTIME = 0.12;

// Runtime distance nudge (owner request). Looser than calibration; sustained
// ~1 s before firing, then a long cooldown.
const RUNTIME_BODY_HEIGHT_MIN = 0.32;
const RUNTIME_BODY_HEIGHT_MAX = 1.05;
const RUNTIME_MIN_SHOULDER_WIDTH = 0.06;
const RUNTIME_DISTANCE_DEBOUNCE_FRAMES = 45;
const RUNTIME_DISTANCE_COOLDOWN_MS = 12_000;

export class StandingFigure4Engine {
  private callbacks: Figure4EngineCallbacks;
  private calibration: StandingFigure4Calibration;
  private baseline: Figure4Baseline | null = null;

  private smoothedComX = 0;
  private smoothedComY = 0;
  private smoothedComInitialized = false;

  private holdBaselineComX: number | null = null;
  private holdBaselineComY: number | null = null;
  private holdBaselineFrames: Array<{ x: number; y: number }> = [];

  private smoothedFormScore = 100;

  // Fix V — paired entry/exit hysteresis per warning.
  private swayBadFrames = 0;
  private swayGoodFrames = 0;
  private swayWarnActive = false;
  private hipTiltBadFrames = 0;
  private hipTiltGoodFrames = 0;
  private hipTiltWarnActive = false;
  private footDroppedBadFrames = 0;
  private footDroppedGoodFrames = 0;
  private footDroppedWarnActive = false;
  private footOffLegBadFrames = 0;
  private footOffLegGoodFrames = 0;
  private footOffLegWarnActive = false;

  private warningCooldowns: Partial<Record<WarningType, number>> = {};

  // Runtime distance monitoring
  private runtimeDistanceBadFrames = 0;
  private lastDistanceWarnAt = 0;

  private holdStartAt: number | null = null;
  private lastTickAt = 0;
  private finished = false;
  private broken = false;

  private accumulatedValidMs = 0;
  private lastFrameAt: number | null = null;
  private wasFormBroken = false;

  private longestUnfrozenStreakMs = 0;
  private currentStreakValidMs = 0;
  private streakBreakStartedAt = 0;
  private streakBreakCommitted = false;

  private lastValidFrameAt = 0;
  private lastPositionLostWarnAt = 0;

  private formBrokenSince: number | null = null;
  private lastNotMovingWarnAt = 0;

  // Terminal-rise debounce + forgiving form-break escalation.
  private shoulderRiseFrames = 0;
  private continuousFrozenMs = 0;
  private breakCount = 0;

  constructor(callbacks: Figure4EngineCallbacks = {}) {
    this.callbacks = callbacks;
    this.calibration = new StandingFigure4Calibration();
  }

  update(landmarks: PoseLandmarks | null, now: number): void {
    if (this.finished) return;

    if (!this.calibration.isConfirmed()) {
      const calUpdate = this.calibration.update(landmarks, now);
      this.callbacks.onCalibrationUpdate?.(calUpdate);
      if (calUpdate.state === 'confirmed') {
        this.baseline = this.calibration.getBaseline();
        this.holdStartAt = now;
        this.lastTickAt = now;
        this.lastValidFrameAt = now;
        debugLog('FIG4', 'HOLD', 'Hold started', {
          liftedSide: this.baseline?.liftedSide,
          standingKneeX: this.baseline ? +this.baseline.standingKneeX.toFixed(3) : null,
          shoulderWidth: this.baseline ? +this.baseline.shoulderWidth.toFixed(3) : null,
        });
      }
      return;
    }

    const haveValidFrame = !!landmarks && this.hasCoreLandmarks(landmarks);
    this.checkPositionLost(haveValidFrame, now);

    if (!haveValidFrame || !this.baseline || !this.holdStartAt) return;
    this.processHoldFrame(landmarks!, now);
  }

  finish(): void { this.finished = true; }
  resetForNextSet(): void { /* noop — hold-based */ }

  // ----------------------------------------------------------
  private processHoldFrame(landmarks: PoseLandmarks, now: number): void {
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

    // Hold broken: user stood fully back up. Terminal, but only on a SUSTAINED
    // rise (debounced) so a wobble doesn't end the hold.
    const shoulderY = (ls.y + rs.y) / 2;
    const shoulderRise = baseline.shoulderY - shoulderY;
    this.shoulderRiseFrames = shoulderRise > HOLD_BROKEN_SHOULDER_RISE ? this.shoulderRiseFrames + 1 : 0;
    if (this.shoulderRiseFrames >= SHOULDER_RISE_DEBOUNCE_FRAMES) {
      this.fireHoldBroken('shoulder-rise', now, { shoulderRise });
      return;
    }

    // Runtime distance nudge (sustained, debounced). Does not affect the score.
    this.checkRuntimeDistance(ls, rs, la, ra, now);

    const refShoulderWidth = Math.max(baseline.shoulderWidth, MIN_SHOULDER_WIDTH_RUNTIME);
    const liftedAnkle = baseline.liftedSide === 'left' ? la : ra;
    const standingAnkle = baseline.liftedSide === 'left' ? ra : la;
    const liftedKnee = baseline.liftedSide === 'left' ? lk : rk;
    const standingKnee = baseline.liftedSide === 'left' ? rk : lk;

    // Foot-dropped: ankle AND knee both indicate the crossed leg has dropped (Fix Y).
    const ankleYDelta = standingAnkle.y - liftedAnkle.y;
    const kneeYDelta = standingKnee.y - liftedKnee.y;
    const footDroppedBad =
      ankleYDelta < refShoulderWidth * FOOT_DROPPED_RATIO
      && kneeYDelta < refShoulderWidth * FOOT_DROPPED_KNEE_RATIO;

    // Foot-off-leg: crossed ankle X drifts from standing knee X.
    const footOffLegDistance = Math.abs(liftedAnkle.x - standingKnee.x);
    const footOffLegBad = footOffLegDistance > FOOT_ON_LEG_X_TOLERANCE;

    // Per-frame CoM proxy + EMA smoothing
    const com = comProxy(ls, rs, lh, rh);
    if (!this.smoothedComInitialized) {
      this.smoothedComX = com.x;
      this.smoothedComY = com.y;
      this.smoothedComInitialized = true;
    } else {
      this.smoothedComX = SMOOTHING_ALPHA * com.x + (1 - SMOOTHING_ALPHA) * this.smoothedComX;
      this.smoothedComY = SMOOTHING_ALPHA * com.y + (1 - SMOOTHING_ALPHA) * this.smoothedComY;
    }

    // Hold baseline from first 30 valid frames.
    if (this.holdBaselineComX === null) {
      this.holdBaselineFrames.push({ x: this.smoothedComX, y: this.smoothedComY });
      if (this.holdBaselineFrames.length >= HOLD_BASELINE_FRAMES) {
        const meanX = this.holdBaselineFrames.reduce((s, p) => s + p.x, 0) / this.holdBaselineFrames.length;
        const meanY = this.holdBaselineFrames.reduce((s, p) => s + p.y, 0) / this.holdBaselineFrames.length;
        this.holdBaselineComX = meanX;
        this.holdBaselineComY = meanY;
        debugLog('FIG4', 'HOLD', 'Hold baseline captured', {
          baselineX: +meanX.toFixed(3),
          baselineY: +meanY.toFixed(3),
        });
      }
      this.emitFrameMetrics(0, 0, 0, footOffLegDistance, false);
      return;
    }

    // Sway displacement (distance-independent via shoulder-width).
    const baseComX = this.holdBaselineComX;
    const baseComY = this.holdBaselineComY!;
    const dx = this.smoothedComX - baseComX;
    const dy = this.smoothedComY - baseComY;
    const rawDisplacement = Math.hypot(dx, dy) / refShoulderWidth;
    const swayAngleDeg = Math.atan2(rawDisplacement, 1.0) * (180 / Math.PI);

    // Hip tilt: crossed-side hip should stay near standing-side hip Y.
    const liftedHip = baseline.liftedSide === 'left' ? lh : rh;
    const standingHip = baseline.liftedSide === 'left' ? rh : lh;
    const hipDropAmount = liftedHip.y - standingHip.y;
    const hipTiltBad = hipDropAmount > refShoulderWidth * HIP_TILT_RATIO;

    // Fix V — paired hysteresis for all four warnings.
    const swayBad = swayAngleDeg > SWAY_WARN_ANGLE_DEG;
    this.swayBadFrames = swayBad ? this.swayBadFrames + 1 : 0;
    this.swayGoodFrames = swayBad ? 0 : this.swayGoodFrames + 1;
    if (!this.swayWarnActive && this.swayBadFrames >= SWAY_WARN_FRAMES) {
      this.swayWarnActive = true;
    } else if (this.swayWarnActive && this.swayGoodFrames >= SWAY_RESUME_FRAMES) {
      this.swayWarnActive = false;
    }
    this.hipTiltBadFrames = hipTiltBad ? this.hipTiltBadFrames + 1 : 0;
    this.hipTiltGoodFrames = hipTiltBad ? 0 : this.hipTiltGoodFrames + 1;
    if (!this.hipTiltWarnActive && this.hipTiltBadFrames >= HIP_TILT_DEBOUNCE_FRAMES) {
      this.hipTiltWarnActive = true;
    } else if (this.hipTiltWarnActive && this.hipTiltGoodFrames >= HIP_TILT_RESUME_FRAMES) {
      this.hipTiltWarnActive = false;
    }
    this.footDroppedBadFrames = footDroppedBad ? this.footDroppedBadFrames + 1 : 0;
    this.footDroppedGoodFrames = footDroppedBad ? 0 : this.footDroppedGoodFrames + 1;
    if (!this.footDroppedWarnActive && this.footDroppedBadFrames >= FOOT_DROPPED_DEBOUNCE_FRAMES) {
      this.footDroppedWarnActive = true;
    } else if (this.footDroppedWarnActive && this.footDroppedGoodFrames >= FOOT_DROPPED_RESUME_FRAMES) {
      this.footDroppedWarnActive = false;
    }
    this.footOffLegBadFrames = footOffLegBad ? this.footOffLegBadFrames + 1 : 0;
    this.footOffLegGoodFrames = footOffLegBad ? 0 : this.footOffLegGoodFrames + 1;
    if (!this.footOffLegWarnActive && this.footOffLegBadFrames >= FOOT_OFF_LEG_DEBOUNCE_FRAMES) {
      this.footOffLegWarnActive = true;
    } else if (this.footOffLegWarnActive && this.footOffLegGoodFrames >= FOOT_OFF_LEG_RESUME_FRAMES) {
      this.footOffLegWarnActive = false;
    }

    // Hold-start grace: let the user settle in without an instant freeze.
    const inGrace = now - this.holdStartAt! < HOLD_START_GRACE_MS;
    const swayWarn = this.swayWarnActive && !inGrace;
    const hipTiltWarn = this.hipTiltWarnActive && !inGrace;
    const footDroppedWarn = this.footDroppedWarnActive && !inGrace;
    const footOffLegWarn = this.footOffLegWarnActive && !inGrace;

    this.maybeEmitWarning('swaying', swayWarn, now);
    this.maybeEmitWarning('hip-tilted', hipTiltWarn, now);
    this.maybeEmitWarning('foot-dropped', footDroppedWarn, now);
    this.maybeEmitWarning('foot-off-leg', footOffLegWarn, now);

    // Form score (smoothed)
    const swayPen = getSwayPenalty(swayAngleDeg);
    const tiltPen = getHipTiltPenalty(hipDropAmount, refShoulderWidth);
    const footOffPen = getFootOffLegPenalty(footOffLegDistance);
    const rawFormScore = Math.max(0, 100 - swayPen - tiltPen - footOffPen);
    this.smoothedFormScore = (1 - FORM_SMOOTH_ALPHA) * this.smoothedFormScore + FORM_SMOOTH_ALPHA * rawFormScore;

    // Fix B — accumulate only frames where form is currently OK (all four
    // form warnings freeze the counter per Fix S).
    const formBroken = swayWarn || hipTiltWarn || footDroppedWarn || footOffLegWarn;
    const dtMs = this.lastFrameAt !== null ? now - this.lastFrameAt : 0;
    const validDt = dtMs > 0 && dtMs < 200 ? dtMs : 0;
    if (!formBroken) {
      this.accumulatedValidMs += validDt;
      this.continuousFrozenMs = 0;
    } else {
      this.continuousFrozenMs += validDt;
    }
    this.lastFrameAt = now;
    if (formBroken && !this.wasFormBroken) {
      this.breakCount += 1;
      const reason = footOffLegWarn ? 'foot-off-leg'
        : footDroppedWarn ? 'foot-dropped'
          : hipTiltWarn ? 'hip-tilted'
            : 'swaying';
      debugLog('FIG4', 'TIMER', 'frozen', {
        reason,
        breakCount: this.breakCount,
        accumulatedSec: +(this.accumulatedValidMs / 1000).toFixed(1),
      });
    } else if (!formBroken && this.wasFormBroken) {
      debugLog('FIG4', 'TIMER', 'resumed', {
        accumulatedSec: +(this.accumulatedValidMs / 1000).toFixed(1),
      });
    }
    this.wasFormBroken = formBroken;

    // Forgiving escalation: repeated/sustained form-break ends the hold (audio
    // cue via the hold-broken path, then report).
    if (this.continuousFrozenMs >= FORM_BREAK_END_CONTINUOUS_MS || this.breakCount >= FORM_BREAK_END_COUNT) {
      this.fireHoldBroken('form-break', now, {
        continuousFrozenMs: Math.round(this.continuousFrozenMs),
        breakCount: this.breakCount,
      });
      return;
    }

    // Round 20 — idle nudge while user is out of pose.
    if (formBroken) {
      if (this.formBrokenSince === null) this.formBrokenSince = now;
      const brokenFor = now - this.formBrokenSince;
      const sinceLast = this.lastNotMovingWarnAt > 0
        ? now - this.lastNotMovingWarnAt
        : Infinity;
      if (brokenFor >= NOT_MOVING_TIMEOUT_MS && sinceLast >= NOT_MOVING_REPEAT_MS) {
        this.callbacks.onPostureWarning?.('not-moving');
        this.lastNotMovingWarnAt = now;
        debugLog('FIG4', 'WARN', 'not-moving', { brokenForMs: brokenFor });
      }
    } else {
      this.formBrokenSince = null;
    }

    // Fix U — longest-streak accounting with 1 s debounce.
    if (!formBroken) {
      if (this.streakBreakCommitted) this.streakBreakCommitted = false;
      this.streakBreakStartedAt = 0;
      if (dtMs > 0 && dtMs < 200) this.currentStreakValidMs += dtMs;
    } else {
      if (this.streakBreakStartedAt === 0 && !this.streakBreakCommitted) {
        this.streakBreakStartedAt = now;
      }
      if (
        !this.streakBreakCommitted
        && this.streakBreakStartedAt > 0
        && now - this.streakBreakStartedAt >= MIN_STREAK_BREAK_MS
      ) {
        if (this.currentStreakValidMs > this.longestUnfrozenStreakMs) {
          this.longestUnfrozenStreakMs = this.currentStreakValidMs;
        }
        this.currentStreakValidMs = 0;
        this.streakBreakCommitted = true;
      }
    }

    this.emitFrameMetrics(swayAngleDeg, rawDisplacement, hipDropAmount, footOffLegDistance, false);

    // 1 Hz tick.
    if (now - this.lastTickAt >= TICK_INTERVAL_MS) {
      this.lastTickAt = now;
      const secondsElapsed = Math.floor(this.accumulatedValidMs / 1000);
      const mqs = Math.round(this.smoothedFormScore);
      const longestUnfrozenSec = Math.max(
        Math.floor(this.longestUnfrozenStreakMs / 1000),
        Math.floor(this.currentStreakValidMs / 1000),
      );
      debugLog('FIG4', 'TICK', `Tick ${secondsElapsed}s`, {
        mqs,
        sway: +swayAngleDeg.toFixed(2),
        footOff: +footOffLegDistance.toFixed(3),
        longestUnfrozenSec,
      });
      this.callbacks.onHoldTick?.({ secondsElapsed, mqs, longestUnfrozenSec });
    }
  }

  /** Sustained runtime distance check → too-far / too-close nudge. */
  private checkRuntimeDistance(
    ls: NormalizedLandmark, rs: NormalizedLandmark,
    la: NormalizedLandmark, ra: NormalizedLandmark,
    now: number,
  ): void {
    const shoulderWidth = Math.abs(ls.x - rs.x);
    const shoulderY = (ls.y + rs.y) / 2;
    const bottomY = Math.max(la.y, ra.y);
    const bodyHeight = bottomY - shoulderY;

    let hint: WarningType | null = null;
    if (bodyHeight < RUNTIME_BODY_HEIGHT_MIN || shoulderWidth < RUNTIME_MIN_SHOULDER_WIDTH) {
      hint = 'too-far';
    } else if (bodyHeight > RUNTIME_BODY_HEIGHT_MAX) {
      hint = 'too-close';
    }

    if (!hint) {
      this.runtimeDistanceBadFrames = 0;
      return;
    }
    this.runtimeDistanceBadFrames++;
    if (this.runtimeDistanceBadFrames < RUNTIME_DISTANCE_DEBOUNCE_FRAMES) return;
    // Cold-start sentinel (Fix P): allow the first nudge even when engine `now`
    // is still below the cooldown window.
    const distanceCueAllowed = this.lastDistanceWarnAt === 0
      || now - this.lastDistanceWarnAt >= RUNTIME_DISTANCE_COOLDOWN_MS;
    if (!distanceCueAllowed) return;
    this.lastDistanceWarnAt = now;
    debugLog('FIG4', 'WARN', hint, { bodyHeight: +bodyHeight.toFixed(3), shoulderWidth: +shoulderWidth.toFixed(3) });
    this.callbacks.onPostureWarning?.(hint);
  }

  private fireHoldBroken(reason: string, now: number, extra: Record<string, unknown>): void {
    if (this.broken) return;
    this.broken = true;
    const atSec = this.holdStartAt ? Math.floor((now - this.holdStartAt) / 1000) : 0;
    debugLog('FIG4', 'BROKEN', 'Hold ended early', { reason, atSec, ...extra });
    this.maybeEmitWarning('hold-broken', true, now);
    this.callbacks.onHoldBroken?.();
    this.finish();
  }

  private emitFrameMetrics(
    swayAngleDeg: number,
    swayDisplacement: number,
    hipDropAmount: number,
    footOffLegDistance: number,
    isHoldBroken: boolean,
  ): void {
    const metrics: Figure4FrameMetrics = {
      swayAngleDeg,
      swayDisplacement,
      hipDropAmount,
      footOffLegDistance,
      formScore: this.smoothedFormScore,
      isHoldBroken,
    };
    this.callbacks.onFrame?.(metrics);
  }

  private maybeEmitWarning(type: WarningType, active: boolean, now: number): void {
    if (!active) return;
    // Cold-start sentinel (Fix P): always allow the FIRST fire; the cooldown
    // only throttles re-fires.
    const last = this.warningCooldowns[type];
    if (last !== undefined && now - last < WARNING_REPEAT_COOLDOWN_MS) return;
    this.warningCooldowns[type] = now;
    debugLog('FIG4', 'WARN', type);
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
    debugLog('FIG4', 'WARN', 'position-lost', { lostMs: Math.round(lostMs) });
    this.callbacks.onPostureWarning?.('position-lost');
  }
}
