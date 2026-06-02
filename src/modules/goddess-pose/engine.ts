/**
 * GoddessPoseEngine — hold-based tracker for Goddess Pose (Utkata Konasana).
 *
 * Front-facing camera. User in a WIDE stance, knees bent ~90 ° with both
 * thighs close to parallel, arms in "cactus" position (shoulders abducted
 * ~90 °, elbows bent ~90 ° at shoulder height, palms forward).
 *
 * Mirrors warrior-2's hold lifecycle (cal → continuous tracking → 1 Hz tick →
 * hold-broken on stand-up) with five per-frame metrics:
 *   - avgKneeFlexDeg     (target 70–115 °, warn outside on either end)
 *   - kneeAnkleRatio     (target ≥ 0.75 — warn below = knees caving inward)
 *   - elbowDrop          (target ≤ 0.10 sw — warn above = cactus broken)
 *   - trunkLeanDeg       (target < 20 ° from vertical)
 *   - shoulderRise       (terminal at > 0.15)
 *
 * Both knees AND both arms are validated — front camera makes this trackable
 * (unlike warrior-2 which skips arm validation from a side camera).
 *
 * Fix list applied: A/B/E/F/G/H/J/N/Q/S/U/V/W/X.
 */
import type { PoseLandmarks } from '@/modules/pose/types';
import type { WarningType } from '@/store/workout';
import {
  LM,
  lmVisible,
  kneeFlexionDeg,
  trunkLeanDeg,
  midpoint,
  kneeAnkleRatio,
  elbowDropFromCactus,
} from './geometry';
import { GoddessPoseCalibration, MIN_SHOULDER_WIDTH } from './calibration';
import type {
  GoddessPoseBaseline,
  GoddessPoseEngineCallbacks,
  GoddessPoseFrameMetrics,
} from './types';
import { debugLog } from '@/lib/debug';

// Fix W — aggressive EMA smoothing for hold-based MediaPipe noise.
const SMOOTHING_ALPHA = 0.20;
const FORM_SMOOTH_ALPHA = 0.15;

// Knee flex target range. Warn outside on either end.
const KNEE_FLEX_MIN_DEG = 70;
const KNEE_FLEX_MAX_DEG = 115;
// Knee-X / ankle-X ratio. Below this = knees caving inward (valgus).
const KNEES_CAVING_RATIO_MAX = 0.75;
// Elbow drop from baseline cactus line (shoulder-width units).
const ARMS_DROPPED_THRESHOLD = 0.10;
// Trunk lean from vertical — beyond this = leaning too far forward.
const TRUNK_LEAN_MAX_DEG = 20;
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

export class GoddessPoseEngine {
  private callbacks: GoddessPoseEngineCallbacks;
  private calibration: GoddessPoseCalibration;
  private baseline: GoddessPoseBaseline | null = null;

  // EMA-smoothed per-frame metrics.
  private smoothedAvgKneeFlex = 0;
  private smoothedKneeAnkleRatio = 1;
  private smoothedElbowDrop = 0;
  private smoothedTrunkLean = 0;
  private smoothedFormScore = 100;
  private smoothInitialized = false;

  // Fix V — paired hysteresis pairs for each warning.
  private kneesCavingPair = newPair();
  private armsDroppedPair = newPair();
  private kneeShallowPair = newPair();
  private kneeDeepPair = newPair();
  private trunkLeanPair = newPair();

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

  constructor(callbacks: GoddessPoseEngineCallbacks = {}) {
    this.callbacks = callbacks;
    this.calibration = new GoddessPoseCalibration();
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
        debugLog('GODDESS', 'HOLD', 'Hold started', {
          shoulderWidth: this.baseline ? +this.baseline.shoulderWidth.toFixed(3) : null,
          ankleXDist: this.baseline ? +this.baseline.ankleXDist.toFixed(3) : null,
          initialAvgKneeFlex: this.baseline ? +this.baseline.initialAvgKneeFlexDeg.toFixed(1) : null,
          elbowYRelShoulder: this.baseline ? +this.baseline.initialElbowYRelShoulder.toFixed(3) : null,
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
    const swFloor = Math.max(baseline.shoulderWidth, MIN_SHOULDER_WIDTH_RUNTIME);

    const ls = landmarks[LM.LEFT_SHOULDER];
    const rs = landmarks[LM.RIGHT_SHOULDER];
    const le = landmarks[LM.LEFT_ELBOW];
    const re = landmarks[LM.RIGHT_ELBOW];
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
        debugLog('GODDESS', 'BROKEN', 'Hold ended early', {
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
    const rawAvgKneeFlex = (leftFlex + rightFlex) / 2;
    const rawKneeAnkleRatio = kneeAnkleRatio(lk, rk, la, ra);
    const rawElbowDrop = elbowDropFromCactus(le, re, baseline.initialElbowYRelShoulder, shoulderY, swFloor);
    const shoulderMid = midpoint(ls, rs);
    const hipMid = midpoint(lh, rh);
    const rawTrunkLean = trunkLeanDeg(shoulderMid, hipMid);

    // EMA smoothing — first frame seeds from raw.
    if (!this.smoothInitialized) {
      this.smoothedAvgKneeFlex = rawAvgKneeFlex;
      this.smoothedKneeAnkleRatio = rawKneeAnkleRatio;
      this.smoothedElbowDrop = rawElbowDrop;
      this.smoothedTrunkLean = rawTrunkLean;
      this.smoothInitialized = true;
    } else {
      this.smoothedAvgKneeFlex = SMOOTHING_ALPHA * rawAvgKneeFlex + (1 - SMOOTHING_ALPHA) * this.smoothedAvgKneeFlex;
      this.smoothedKneeAnkleRatio = SMOOTHING_ALPHA * rawKneeAnkleRatio + (1 - SMOOTHING_ALPHA) * this.smoothedKneeAnkleRatio;
      this.smoothedElbowDrop = SMOOTHING_ALPHA * rawElbowDrop + (1 - SMOOTHING_ALPHA) * this.smoothedElbowDrop;
      this.smoothedTrunkLean = SMOOTHING_ALPHA * rawTrunkLean + (1 - SMOOTHING_ALPHA) * this.smoothedTrunkLean;
    }

    // Per-frame bad flags.
    const kneesCavingBad = this.smoothedKneeAnkleRatio < KNEES_CAVING_RATIO_MAX;
    const armsDroppedBad = this.smoothedElbowDrop > ARMS_DROPPED_THRESHOLD;
    const kneeShallowBad = this.smoothedAvgKneeFlex < KNEE_FLEX_MIN_DEG;
    const kneeDeepBad = this.smoothedAvgKneeFlex > KNEE_FLEX_MAX_DEG;
    const trunkLeanBad = this.smoothedTrunkLean > TRUNK_LEAN_MAX_DEG;

    // Fix V — paired entry/exit hysteresis on each warning.
    tickPair(this.kneesCavingPair, kneesCavingBad);
    tickPair(this.armsDroppedPair, armsDroppedBad);
    tickPair(this.kneeShallowPair, kneeShallowBad);
    tickPair(this.kneeDeepPair, kneeDeepBad);
    tickPair(this.trunkLeanPair, trunkLeanBad);

    const kneesCavingWarn = this.kneesCavingPair.active;
    const armsDroppedWarn = this.armsDroppedPair.active;
    const kneeShallowWarn = this.kneeShallowPair.active;
    const kneeDeepWarn = this.kneeDeepPair.active;
    const trunkLeanWarn = this.trunkLeanPair.active;

    this.maybeEmitWarning('knees-caving', kneesCavingWarn, now);
    this.maybeEmitWarning('arms-dropped', armsDroppedWarn, now);
    this.maybeEmitWarning('knee-too-straight', kneeShallowWarn, now);
    this.maybeEmitWarning('knee-too-deep', kneeDeepWarn, now);
    this.maybeEmitWarning('torso-too-forward', trunkLeanWarn, now);

    // Form score: penalise per active warning.
    const cavingPenalty = kneesCavingWarn
      ? Math.min(35, (KNEES_CAVING_RATIO_MAX - this.smoothedKneeAnkleRatio) * 100)
      : 0;
    const armsPenalty = armsDroppedWarn
      ? Math.min(30, (this.smoothedElbowDrop - ARMS_DROPPED_THRESHOLD) * 150)
      : 0;
    const shallowPenalty = kneeShallowWarn
      ? Math.min(30, (KNEE_FLEX_MIN_DEG - this.smoothedAvgKneeFlex) * 1.5)
      : 0;
    const deepPenalty = kneeDeepWarn
      ? Math.min(25, (this.smoothedAvgKneeFlex - KNEE_FLEX_MAX_DEG) * 1.5)
      : 0;
    const trunkPenalty = trunkLeanWarn
      ? Math.min(30, (this.smoothedTrunkLean - TRUNK_LEAN_MAX_DEG) * 2)
      : 0;
    const rawFormScore = Math.max(
      0,
      100 - cavingPenalty - armsPenalty - shallowPenalty - deepPenalty - trunkPenalty,
    );
    this.smoothedFormScore = (1 - FORM_SMOOTH_ALPHA) * this.smoothedFormScore + FORM_SMOOTH_ALPHA * rawFormScore;

    // Fix B / Fix S — accumulate only frames where form is currently OK. All
    // five warnings are structural (recoverable but freeze the timer).
    const formBroken = kneesCavingWarn || armsDroppedWarn || kneeShallowWarn || kneeDeepWarn || trunkLeanWarn;
    const dtMs = this.lastFrameAt !== null ? now - this.lastFrameAt : 0;
    if (!formBroken && dtMs > 0 && dtMs < 200) {
      this.accumulatedValidMs += dtMs;
    }
    this.lastFrameAt = now;

    // Fix E — TIMER frozen/resumed debug logs on freeze edges.
    if (formBroken && !this.wasFormBroken) {
      const reason = kneesCavingWarn ? 'knees-caving'
        : armsDroppedWarn ? 'arms-dropped'
          : kneeShallowWarn ? 'knee-too-straight'
            : kneeDeepWarn ? 'knee-too-deep'
              : 'torso-too-forward';
      debugLog('GODDESS', 'TIMER', 'frozen', {
        reason,
        accumulatedSec: +(this.accumulatedValidMs / 1000).toFixed(1),
      });
    } else if (!formBroken && this.wasFormBroken) {
      debugLog('GODDESS', 'TIMER', 'resumed', {
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

    const metrics: GoddessPoseFrameMetrics = {
      avgKneeFlexDeg: this.smoothedAvgKneeFlex,
      kneeAnkleRatio: this.smoothedKneeAnkleRatio,
      elbowDrop: this.smoothedElbowDrop,
      trunkLeanDeg: this.smoothedTrunkLean,
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
      debugLog('GODDESS', 'TICK', `Tick ${secondsElapsed}s`, {
        mqs,
        avgKnee: +this.smoothedAvgKneeFlex.toFixed(1),
        kneeAnkleRatio: +this.smoothedKneeAnkleRatio.toFixed(2),
        elbowDrop: +this.smoothedElbowDrop.toFixed(2),
        trunk: +this.smoothedTrunkLean.toFixed(1),
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
    debugLog('GODDESS', 'WARN', type);
    this.callbacks.onPostureWarning?.(type);
  }

  // ----------------------------------------------------------
  // Fix N — position-lost detection
  // ----------------------------------------------------------
  private hasCoreLandmarks(landmarks: PoseLandmarks): boolean {
    // Goddess needs both shoulders + both elbows + both hips + both knees +
    // both ankles. Wrists are nice-to-have for cactus tracking but elbows are
    // the primary signal — exclude wrists from the core set so a brief wrist
    // occlusion doesn't fire position-lost.
    return lmVisible(landmarks[LM.LEFT_SHOULDER]) && lmVisible(landmarks[LM.RIGHT_SHOULDER])
      && lmVisible(landmarks[LM.LEFT_ELBOW]) && lmVisible(landmarks[LM.RIGHT_ELBOW])
      && lmVisible(landmarks[LM.LEFT_HIP]) && lmVisible(landmarks[LM.RIGHT_HIP])
      && lmVisible(landmarks[LM.LEFT_KNEE]) && lmVisible(landmarks[LM.RIGHT_KNEE])
      && lmVisible(landmarks[LM.LEFT_ANKLE]) && lmVisible(landmarks[LM.RIGHT_ANKLE]);
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
    debugLog('GODDESS', 'WARN', 'position-lost', { lostMs: Math.round(lostMs) });
    this.callbacks.onPostureWarning?.('position-lost');
  }
}
