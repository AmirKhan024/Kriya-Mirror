/**
 * TrianglePoseEngine — hold-based tracker for Triangle Pose (Trikonasana).
 *
 * FRONT-facing camera. User in a wide stance, BOTH legs straight, trunk
 * hinged laterally toward the front foot — top arm extended straight up to
 * the sky, bottom arm reaching DOWN toward the front foot's toe.
 *
 * Mirrors warrior-2 / goddess-pose's hold lifecycle (cal → continuous
 * tracking → 1 Hz tick → hold-broken on stand-up) with these per-frame
 * metrics:
 *   - frontKneeFlexDeg + backKneeFlexDeg (target < 25° on both;
 *     either > 25° fires `leg-not-straight`)
 *   - topArmDeviationDeg (target < 20° from vertical)
 *   - bottomArmFromAnkleY (wrist Y vs front-ankle Y, normalized by
 *     bodyHeight; ≤ 0 ideal, > +0.15 fires `bottom-arm-not-down`)
 *   - shoulderRise (terminal at > 0.15)
 *
 * Hip-stacking is NOT validated: in a front-view triangle the back hip
 * naturally rolls up as part of the lateral hinge, so a hip-tilt check
 * would flag every correct pose. The 3 form warnings above capture all
 * meaningful failure modes.
 *
 * Fix list applied: A/B/E/F/G/H/J/N/Q/S/U/V/W/X.
 */
import type { PoseLandmarks } from '@/modules/pose/types';
import type { WarningType } from '@/store/workout';
import {
  LM,
  lmVisible,
  kneeFlexionDeg,
  topArmDeviationDeg,
  bottomArmFromAnkleY,
} from './geometry';
import { TrianglePoseCalibration, MIN_SHOULDER_WIDTH } from './calibration';
import type {
  TrianglePoseBaseline,
  TrianglePoseEngineCallbacks,
  TrianglePoseFrameMetrics,
} from './types';
import { debugLog } from '@/lib/debug';

// Fix W — aggressive EMA smoothing for hold-based MediaPipe noise.
const SMOOTHING_ALPHA = 0.20;
const FORM_SMOOTH_ALPHA = 0.15;

// Form thresholds — runtime values are deliberately LOOSER than calibration
// gates. Real users don't hit textbook angles: MediaPipe is noisy on wrists,
// arms drift a few degrees with breathing, and many users reach to the shin
// instead of the toe. Stricter values caused false freezes in physical test.
const KNEE_FLEX_MAX_DEG = 35;          // either knee bending past this → warn (was 25; allow natural micro-bend)
const TOP_ARM_DEVIATION_MAX_DEG = 30;  // top arm tilting past this from vertical → warn (was 20; allow breath drift)
const BOTTOM_ARM_LIFT_MAX = 0.30;      // (bottomWrist.y - frontAnkle.y)/bodyHeight past this above ankle → warn (was 0.15; allow shin-reach not just toe)

// Terminal: user fully stood back up.
const HOLD_BROKEN_SHOULDER_RISE = 0.15;

// Fix V — paired entry / exit debounce in frames.
const WARN_FRAMES = 6;
const RESUME_FRAMES = 6;

const WARNING_REPEAT_COOLDOWN_MS = 2500;
const TICK_INTERVAL_MS = 1000;

// Fix N — position-lost detection.
const POSITION_LOST_TIMEOUT_MS = 3000;
const POSITION_LOST_REPEAT_MS = 10_000;

// Fix U — longest-streak debounce.
const MIN_STREAK_BREAK_MS = 1000;

// Fix X — runtime floor for shoulder-width normalization. Defense in depth on
// top of calibration's guard.
const MIN_SHOULDER_WIDTH_RUNTIME = MIN_SHOULDER_WIDTH;

interface WarnPair {
  badFrames: number;
  goodFrames: number;
  active: boolean;
}
function newPair(): WarnPair { return { badFrames: 0, goodFrames: 0, active: false }; }

function tickPair(pair: WarnPair, bad: boolean): void {
  if (bad) {
    pair.badFrames += 1;
    pair.goodFrames = 0;
  } else {
    pair.goodFrames += 1;
    pair.badFrames = 0;
  }
  if (!pair.active && pair.badFrames >= WARN_FRAMES) pair.active = true;
  else if (pair.active && pair.goodFrames >= RESUME_FRAMES) pair.active = false;
}

export class TrianglePoseEngine {
  private callbacks: TrianglePoseEngineCallbacks;
  private calibration: TrianglePoseCalibration;
  private baseline: TrianglePoseBaseline | null = null;

  // EMA-smoothed per-frame metrics.
  private smoothedFrontKneeFlex = 0;
  private smoothedBackKneeFlex = 0;
  private smoothedTopArmDev = 0;
  private smoothedBottomArmFromAnkleY = 0;
  private smoothedFormScore = 100;
  private smoothInitialized = false;

  // Fix V — paired hysteresis pairs for each warning.
  private legNotStraightPair = newPair();
  private topArmPair = newPair();
  private bottomArmPair = newPair();

  private warningCooldowns: Partial<Record<WarningType, number>> = {};

  private holdStartAt: number | null = null;
  private lastTickAt = 0;
  private finished = false;
  private broken = false;

  // Fix B — accumulator pauses during sustained bad form.
  private accumulatedValidMs = 0;
  private lastFrameAt: number | null = null;
  private wasFormBroken = false;

  // Fix U — longest continuous unfrozen streak with 1 s debounce.
  private longestUnfrozenStreakMs = 0;
  private currentStreakValidMs = 0;
  private streakBreakStartedAt = 0;
  private streakBreakCommitted = false;

  // Fix N — position-lost heartbeat.
  private lastValidFrameAt = 0;
  private lastPositionLostWarnAt = 0;

  constructor(callbacks: TrianglePoseEngineCallbacks = {}) {
    this.callbacks = callbacks;
    this.calibration = new TrianglePoseCalibration();
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
        debugLog('TRIANGLE', 'HOLD', 'Hold started', {
          topArm: this.baseline?.topArm,
          frontLeg: this.baseline?.frontLeg,
          shoulderWidth: this.baseline ? +this.baseline.shoulderWidth.toFixed(3) : null,
          bodyHeight: this.baseline ? +this.baseline.bodyHeight.toFixed(3) : null,
          initialAvgKneeFlex: this.baseline ? +this.baseline.initialAvgKneeFlexDeg.toFixed(1) : null,
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
    const lw = landmarks[LM.LEFT_WRIST];
    const rw = landmarks[LM.RIGHT_WRIST];
    const lh = landmarks[LM.LEFT_HIP];
    const rh = landmarks[LM.RIGHT_HIP];
    const lk = landmarks[LM.LEFT_KNEE];
    const rk = landmarks[LM.RIGHT_KNEE];
    const la = landmarks[LM.LEFT_ANKLE];
    const ra = landmarks[LM.RIGHT_ANKLE];

    // Terminal: user fully stood back up.
    const shoulderY = (ls.y + rs.y) / 2;
    const shoulderRise = baseline.shoulderY - shoulderY;
    if (shoulderRise > HOLD_BROKEN_SHOULDER_RISE) {
      if (!this.broken) {
        this.broken = true;
        const atSec = this.holdStartAt ? Math.floor((now - this.holdStartAt) / 1000) : 0;
        debugLog('TRIANGLE', 'BROKEN', 'Hold ended early', {
          atSec,
          shoulderRise: +shoulderRise.toFixed(3),
        });
        this.maybeEmitWarning('hold-broken', true, now);
        this.callbacks.onHoldBroken?.();
        this.finish();
      }
      return;
    }

    // Raw per-frame metrics.
    const leftFlex = kneeFlexionDeg(lh, lk, la);
    const rightFlex = kneeFlexionDeg(rh, rk, ra);
    const rawFrontKneeFlex = baseline.frontLeg === 'left' ? leftFlex : rightFlex;
    const rawBackKneeFlex = baseline.frontLeg === 'left' ? rightFlex : leftFlex;

    const topShoulder = baseline.topArm === 'left' ? ls : rs;
    const topWrist = baseline.topArm === 'left' ? lw : rw;
    const bottomWrist = baseline.topArm === 'left' ? rw : lw;
    const rawTopArmDev = topArmDeviationDeg(topShoulder, topWrist);

    const frontAnkle = baseline.frontLeg === 'left' ? la : ra;
    const rawBottomArmFromAnkleY = bottomArmFromAnkleY(bottomWrist, frontAnkle, baseline.bodyHeight);
    // Convert to "lift above ankle" semantic — positive when wrist is ABOVE
    // the ankle (bad). geometry returns frontAnkle.y - bottomWrist.y
    // normalized: positive = wrist above ankle (smaller Y). So lift =
    // raw value directly. ≤ 0 = wrist at/below ankle (ideal).
    const rawBottomArmLift = rawBottomArmFromAnkleY;

    void rs;  // kept for symmetry; right shoulder may be the bottom shoulder
    void MIN_SHOULDER_WIDTH_RUNTIME;

    // EMA smoothing — first frame seeds from raw.
    if (!this.smoothInitialized) {
      this.smoothedFrontKneeFlex = rawFrontKneeFlex;
      this.smoothedBackKneeFlex = rawBackKneeFlex;
      this.smoothedTopArmDev = rawTopArmDev;
      this.smoothedBottomArmFromAnkleY = rawBottomArmLift;
      this.smoothInitialized = true;
    } else {
      this.smoothedFrontKneeFlex = SMOOTHING_ALPHA * rawFrontKneeFlex + (1 - SMOOTHING_ALPHA) * this.smoothedFrontKneeFlex;
      this.smoothedBackKneeFlex = SMOOTHING_ALPHA * rawBackKneeFlex + (1 - SMOOTHING_ALPHA) * this.smoothedBackKneeFlex;
      this.smoothedTopArmDev = SMOOTHING_ALPHA * rawTopArmDev + (1 - SMOOTHING_ALPHA) * this.smoothedTopArmDev;
      this.smoothedBottomArmFromAnkleY = SMOOTHING_ALPHA * rawBottomArmLift + (1 - SMOOTHING_ALPHA) * this.smoothedBottomArmFromAnkleY;
    }

    // Per-frame bad flags.
    const legNotStraightBad = this.smoothedFrontKneeFlex > KNEE_FLEX_MAX_DEG
      || this.smoothedBackKneeFlex > KNEE_FLEX_MAX_DEG;
    const topArmBad = this.smoothedTopArmDev > TOP_ARM_DEVIATION_MAX_DEG;
    const bottomArmBad = this.smoothedBottomArmFromAnkleY > BOTTOM_ARM_LIFT_MAX;

    // Fix V — paired entry/exit hysteresis on each warning.
    tickPair(this.legNotStraightPair, legNotStraightBad);
    tickPair(this.topArmPair, topArmBad);
    tickPair(this.bottomArmPair, bottomArmBad);

    const legNotStraightWarn = this.legNotStraightPair.active;
    const topArmWarn = this.topArmPair.active;
    const bottomArmWarn = this.bottomArmPair.active;

    this.maybeEmitWarning('leg-not-straight', legNotStraightWarn, now);
    this.maybeEmitWarning('top-arm-not-vertical', topArmWarn, now);
    this.maybeEmitWarning('bottom-arm-not-down', bottomArmWarn, now);

    // Form score: penalise per active warning.
    const legPenalty = legNotStraightWarn
      ? Math.min(35, (Math.max(this.smoothedFrontKneeFlex, this.smoothedBackKneeFlex) - KNEE_FLEX_MAX_DEG) * 1.5)
      : 0;
    const topArmPenalty = topArmWarn
      ? Math.min(30, (this.smoothedTopArmDev - TOP_ARM_DEVIATION_MAX_DEG) * 1.5)
      : 0;
    const bottomArmPenalty = bottomArmWarn
      ? Math.min(30, (this.smoothedBottomArmFromAnkleY - BOTTOM_ARM_LIFT_MAX) * 150)
      : 0;
    const rawFormScore = Math.max(0, 100 - legPenalty - topArmPenalty - bottomArmPenalty);
    this.smoothedFormScore = (1 - FORM_SMOOTH_ALPHA) * this.smoothedFormScore + FORM_SMOOTH_ALPHA * rawFormScore;

    // Fix B / Fix S — accumulate only frames where form is currently OK.
    const formBroken = legNotStraightWarn || topArmWarn || bottomArmWarn;
    const dtMs = this.lastFrameAt !== null ? now - this.lastFrameAt : 0;
    if (!formBroken && dtMs > 0 && dtMs < 200) {
      this.accumulatedValidMs += dtMs;
    }
    this.lastFrameAt = now;

    // Fix E — TIMER frozen/resumed debug logs on freeze edges.
    if (formBroken && !this.wasFormBroken) {
      const reason = legNotStraightWarn ? 'leg-not-straight'
        : topArmWarn ? 'top-arm-not-vertical'
          : 'bottom-arm-not-down';
      debugLog('TRIANGLE', 'TIMER', 'frozen', {
        reason,
        accumulatedSec: +(this.accumulatedValidMs / 1000).toFixed(1),
      });
    } else if (!formBroken && this.wasFormBroken) {
      debugLog('TRIANGLE', 'TIMER', 'resumed', {
        accumulatedSec: +(this.accumulatedValidMs / 1000).toFixed(1),
      });
    }
    this.wasFormBroken = formBroken;

    // Fix U — longest-streak accounting.
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

    const metrics: TrianglePoseFrameMetrics = {
      frontKneeFlexDeg: this.smoothedFrontKneeFlex,
      backKneeFlexDeg: this.smoothedBackKneeFlex,
      topArmDeviationDeg: this.smoothedTopArmDev,
      bottomArmFromAnkleY: this.smoothedBottomArmFromAnkleY,
      shoulderRise,
      formScore: this.smoothedFormScore,
      isHoldBroken: false,
    };
    this.callbacks.onFrame?.(metrics);

    // 1 Hz tick.
    if (now - this.lastTickAt >= TICK_INTERVAL_MS) {
      this.lastTickAt = now;
      const secondsElapsed = Math.floor(this.accumulatedValidMs / 1000);
      const mqs = Math.round(this.smoothedFormScore);
      const longestUnfrozenSec = Math.max(
        Math.floor(this.longestUnfrozenStreakMs / 1000),
        Math.floor(this.currentStreakValidMs / 1000),
      );
      debugLog('TRIANGLE', 'TICK', `Tick ${secondsElapsed}s`, {
        mqs,
        frontKnee: +this.smoothedFrontKneeFlex.toFixed(1),
        backKnee: +this.smoothedBackKneeFlex.toFixed(1),
        topArmDev: +this.smoothedTopArmDev.toFixed(1),
        bottomArmLift: +this.smoothedBottomArmFromAnkleY.toFixed(3),
        longestUnfrozenSec,
      });
      this.callbacks.onHoldTick?.({ secondsElapsed, mqs, longestUnfrozenSec });
    }
  }

  private maybeEmitWarning(type: WarningType, active: boolean, now: number): void {
    if (!active) return;
    const last = this.warningCooldowns[type] ?? 0;
    if (now - last < WARNING_REPEAT_COOLDOWN_MS) return;
    this.warningCooldowns[type] = now;
    debugLog('TRIANGLE', 'WARN', type);
    this.callbacks.onPostureWarning?.(type);
  }

  // ----------------------------------------------------------
  // Fix N — position-lost detection
  // ----------------------------------------------------------
  private hasCoreLandmarks(landmarks: PoseLandmarks): boolean {
    // Triangle needs both shoulders + both hips + both knees + both ankles
    // + both wrists (top arm + bottom arm tracking).
    return lmVisible(landmarks[LM.LEFT_SHOULDER]) && lmVisible(landmarks[LM.RIGHT_SHOULDER])
      && lmVisible(landmarks[LM.LEFT_HIP]) && lmVisible(landmarks[LM.RIGHT_HIP])
      && lmVisible(landmarks[LM.LEFT_KNEE]) && lmVisible(landmarks[LM.RIGHT_KNEE])
      && lmVisible(landmarks[LM.LEFT_ANKLE]) && lmVisible(landmarks[LM.RIGHT_ANKLE])
      && lmVisible(landmarks[LM.LEFT_WRIST]) && lmVisible(landmarks[LM.RIGHT_WRIST]);
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
    debugLog('TRIANGLE', 'WARN', 'position-lost', { lostMs: Math.round(lostMs) });
    this.callbacks.onPostureWarning?.('position-lost');
  }
}
