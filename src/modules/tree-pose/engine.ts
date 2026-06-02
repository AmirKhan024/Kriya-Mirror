/**
 * TreePoseEngine — hold-based balance tracker for Tree Pose (Vrikshasana).
 *
 * 90% reuse of SingleLegStandEngine — same hold lifecycle, CoM-proxy sway
 * detection (Fix Z: 12° threshold), Fix V hysteresis on all warnings, Fix S
 * recoverable form-break (freeze timer, don't terminate), Fix U longest-streak
 * with 1 s debounce, Fix N position-lost.
 *
 * NEW vs SLS:
 *   - `foot-off-leg` warning: lifted ankle X drifts > FOOT_ON_LEG_X_TOLERANCE
 *     from standing-knee X for 6+ frames. Recoverable per Fix S — freezes the
 *     hold counter, user can press the foot back onto the leg and continue.
 *   - Calibration gates the foot-on-leg position (see calibration.ts).
 */
import type { PoseLandmarks } from '@/modules/pose/types';
import type { WarningType } from '@/store/workout';
import { LM, lmVisible, comProxy } from './geometry';
import { TreePoseCalibration } from './calibration';
import type { TreePoseBaseline, TreePoseEngineCallbacks, TreePoseFrameMetrics } from './types';
import { getFootOffLegPenalty, getHipTiltPenalty, getSwayPenalty } from './scoring';
import { debugLog } from '@/lib/debug';

// Fix W — aggressive EMA smoothing for hold-based MediaPipe noise.
const SMOOTHING_ALPHA = 0.20;
// Inherited from SLS round 15: 30-frame baseline captures a stabler CoM
// reference than 10 frames (which biased the baseline if the user wobbled
// in the first 333 ms).
const HOLD_BASELINE_FRAMES = 30;

// Fix Z — single-leg sway threshold is 12° (NOT tandem-stand's 6°).
const SWAY_WARN_ANGLE_DEG = 12;
const SWAY_WARN_FRAMES = 6;
const SWAY_RESUME_FRAMES = 6;

const HIP_TILT_RATIO = 0.15;
const HIP_TILT_DEBOUNCE_FRAMES = 6;
const HIP_TILT_RESUME_FRAMES = 6;

// Foot-on-leg gate: lifted ankle X must stay within this tolerance of the
// standing-knee X. Beyond it = foot drifted off the leg.
const FOOT_ON_LEG_X_TOLERANCE = 0.06;
const FOOT_OFF_LEG_DEBOUNCE_FRAMES = 6;
const FOOT_OFF_LEG_RESUME_FRAMES = 6;

// Same as SLS — foot-dropped (foot returns to floor).
const FOOT_DROPPED_RATIO = 0.10;
const FOOT_DROPPED_KNEE_RATIO = 0.20;
const FOOT_DROPPED_DEBOUNCE_FRAMES = 8;
const FOOT_DROPPED_RESUME_FRAMES = 8;
const HOLD_BROKEN_SHOULDER_RISE = 0.15;

const FORM_SMOOTH_ALPHA = 0.15;
const TICK_INTERVAL_MS = 1000;
const WARNING_REPEAT_COOLDOWN_MS = 2500;

// Fix N — position-lost detection.
const POSITION_LOST_TIMEOUT_MS = 3000;
const POSITION_LOST_REPEAT_MS = 10_000;

// 2026-05-28 round 20 — idle/not-moving prompt while user is out of pose.
const NOT_MOVING_TIMEOUT_MS = 5000;
const NOT_MOVING_REPEAT_MS = 15_000;

// Fix U — longest-streak debounce.
const MIN_STREAK_BREAK_MS = 1000;

// Fix X — runtime floor on shoulderWidth so degenerate baselines can't
// collapse distance-normalized thresholds.
const MIN_SHOULDER_WIDTH_RUNTIME = 0.08;

export class TreePoseEngine {
  private callbacks: TreePoseEngineCallbacks;
  private calibration: TreePoseCalibration;
  private baseline: TreePoseBaseline | null = null;

  private smoothedComX = 0;
  private smoothedComY = 0;
  private smoothedComInitialized = false;

  private holdBaselineComX: number | null = null;
  private holdBaselineComY: number | null = null;
  private holdBaselineFrames: Array<{ x: number; y: number }> = [];

  private smoothedFormScore = 100;

  // Fix V — paired entry/exit hysteresis pairs for every form warning.
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

  private holdStartAt: number | null = null;
  private lastTickAt = 0;
  private finished = false;
  private broken = false;

  // Fix B — accumulator freezes during sustained bad form. All four form
  // warnings (sway, hip-tilt, foot-dropped, foot-off-leg) freeze the counter
  // per Fix S; only shoulder-rise terminates.
  private accumulatedValidMs = 0;
  private lastFrameAt: number | null = null;
  private wasFormBroken = false;

  // Fix U — longest continuous unfrozen streak (ms) with 1 s debounce.
  private longestUnfrozenStreakMs = 0;
  private currentStreakValidMs = 0;
  private streakBreakStartedAt = 0;
  private streakBreakCommitted = false;

  // Fix N — position-lost heartbeat.
  private lastValidFrameAt = 0;
  private lastPositionLostWarnAt = 0;

  // Round 20 — idle/not-moving prompt while out of pose.
  private formBrokenSince: number | null = null;
  private lastNotMovingWarnAt = 0;

  constructor(callbacks: TreePoseEngineCallbacks = {}) {
    this.callbacks = callbacks;
    this.calibration = new TreePoseCalibration();
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
        debugLog('TREE', 'HOLD', 'Hold started', {
          liftedSide: this.baseline?.liftedSide,
          standingKneeX: this.baseline ? +this.baseline.standingKneeX.toFixed(3) : null,
          shoulderWidth: this.baseline ? +this.baseline.shoulderWidth.toFixed(3) : null,
        });
      }
      return;
    }

    // Fix N — position-lost check BEFORE landmark-null early return.
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

    // Hold broken: user stood fully back up.
    const shoulderY = (ls.y + rs.y) / 2;
    const shoulderRise = baseline.shoulderY - shoulderY;
    if (shoulderRise > HOLD_BROKEN_SHOULDER_RISE) {
      this.fireHoldBroken('shoulder-rise', now, { shoulderRise });
      return;
    }

    const refShoulderWidth = Math.max(baseline.shoulderWidth, MIN_SHOULDER_WIDTH_RUNTIME);
    const liftedAnkle = baseline.liftedSide === 'left' ? la : ra;
    const standingAnkle = baseline.liftedSide === 'left' ? ra : la;
    const liftedKnee = baseline.liftedSide === 'left' ? lk : rk;
    const standingKnee = baseline.liftedSide === 'left' ? rk : lk;

    // Foot-dropped: ankle AND knee both indicate the leg has dropped (Fix Y).
    const ankleYDelta = standingAnkle.y - liftedAnkle.y;
    const kneeYDelta = standingKnee.y - liftedKnee.y;
    const footDroppedBad =
      ankleYDelta < refShoulderWidth * FOOT_DROPPED_RATIO
      && kneeYDelta < refShoulderWidth * FOOT_DROPPED_KNEE_RATIO;

    // NEW for Tree Pose: foot-off-leg. Lifted ankle X drifts from standing
    // knee X by more than the tolerance = foot is off the leg.
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
        debugLog('TREE', 'HOLD', 'Hold baseline captured', {
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

    // Hip tilt: lifted-side hip should stay near standing-side hip Y.
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

    const swayWarn = this.swayWarnActive;
    const hipTiltWarn = this.hipTiltWarnActive;
    const footDroppedWarn = this.footDroppedWarnActive;
    const footOffLegWarn = this.footOffLegWarnActive;

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

    // Fix B — accumulate only frames where form is currently OK. All four
    // form warnings freeze the counter per Fix S.
    const formBroken = swayWarn || hipTiltWarn || footDroppedWarn || footOffLegWarn;
    const dtMs = this.lastFrameAt !== null ? now - this.lastFrameAt : 0;
    if (!formBroken && dtMs > 0 && dtMs < 200) {
      this.accumulatedValidMs += dtMs;
    }
    this.lastFrameAt = now;
    if (formBroken && !this.wasFormBroken) {
      const reason = footOffLegWarn ? 'foot-off-leg'
        : footDroppedWarn ? 'foot-dropped'
          : hipTiltWarn ? 'hip-tilted'
            : 'swaying';
      debugLog('TREE', 'TIMER', 'frozen', {
        reason,
        accumulatedSec: +(this.accumulatedValidMs / 1000).toFixed(1),
      });
    } else if (!formBroken && this.wasFormBroken) {
      debugLog('TREE', 'TIMER', 'resumed', {
        accumulatedSec: +(this.accumulatedValidMs / 1000).toFixed(1),
      });
    }
    this.wasFormBroken = formBroken;

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
        debugLog('TREE', 'WARN', 'not-moving', { brokenForMs: brokenFor });
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
      debugLog('TREE', 'TICK', `Tick ${secondsElapsed}s`, {
        mqs,
        sway: +swayAngleDeg.toFixed(2),
        footOff: +footOffLegDistance.toFixed(3),
        longestUnfrozenSec,
      });
      this.callbacks.onHoldTick?.({ secondsElapsed, mqs, longestUnfrozenSec });
    }
  }

  private fireHoldBroken(reason: string, now: number, extra: Record<string, unknown>): void {
    if (this.broken) return;
    this.broken = true;
    const atSec = this.holdStartAt ? Math.floor((now - this.holdStartAt) / 1000) : 0;
    debugLog('TREE', 'BROKEN', 'Hold ended early', { reason, atSec, ...extra });
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
    const metrics: TreePoseFrameMetrics = {
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
    const last = this.warningCooldowns[type] ?? 0;
    if (now - last < WARNING_REPEAT_COOLDOWN_MS) return;
    this.warningCooldowns[type] = now;
    debugLog('TREE', 'WARN', type);
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
    debugLog('TREE', 'WARN', 'position-lost', { lostMs: Math.round(lostMs) });
    this.callbacks.onPostureWarning?.('position-lost');
  }
}
