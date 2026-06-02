/**
 * GatePoseEngine — hold-based tracker for Gate Pose (Parighasana): kneel on one
 * knee, extend the other leg out to the side, reach the top arm up and over
 * into a lateral side-bend.
 *
 * FRONT-facing camera. Clones Triangle Pose's hold lifecycle + WarnPair
 * hysteresis, but tracks the two clean, large, front-facing signals of a side
 * bend (the kneeling shin / bottom arm are NOT tracked — they self-occlude):
 *   - lateralLeanDeg   — torso tilt in the frontal plane (hold the bend).
 *                        Dropping below MIN_BEND_HOLD_DEG fires `incomplete-bend`.
 *   - topArmAbove      — the raised (top) wrist height above its shoulder,
 *                        normalized by bodyHeight. Dropping below
 *                        TOP_ARM_HOLD_MIN fires `arms-not-overhead`.
 * Both are recoverable (freeze the timer, Fix S). Only `shoulder-rise`
 * (user stood fully up) terminates the hold. Runtime too-far/too-close nudges
 * during the hold (owner request). All warnings reuse existing WarningTypes.
 *
 * Fix list applied: A/B/E/F/G/H/J/N/Q/S/U/V/W/X + runtime distance.
 */
import type { NormalizedLandmark, PoseLandmarks } from '@/modules/pose/types';
import type { WarningType } from '@/store/workout';
import {
  LM,
  lmVisible,
  midpoint,
  lateralLeanDeg,
  clampLeanDelta,
  MIN_SHOULDER_WIDTH_RUNTIME,
} from './geometry';
import { GatePoseCalibration } from './calibration';
import type {
  GatePoseBaseline,
  GatePoseEngineCallbacks,
  GatePoseFrameMetrics,
} from './types';
import { debugLog } from '@/lib/debug';

const SMOOTHING_ALPHA = 0.20;
const FORM_SMOOTH_ALPHA = 0.15;

// Form thresholds (hold). Hysteresis gap below the calibration gates
// (MIN_BEND_DEG 18, TOP_ARM_ABOVE_MIN 0.08) so the warning doesn't fire
// immediately at hold start.
const MIN_BEND_HOLD_DEG = 10;     // lean below this → came up out of the bend
const TOP_ARM_HOLD_MIN = 0.0;     // top wrist at/above shoulder is enough (physical test: 0.04 nagged)

// Terminal "stood up" margin + debounce: only end on a SUSTAINED rise so a
// momentary wobble never terminates the hold.
const HOLD_BROKEN_SHOULDER_RISE = 0.18;
const SHOULDER_RISE_DEBOUNCE_FRAMES = 18;   // ~0.6 s sustained

// Form-break grace + forgiving escalation (see star-pose for the rationale).
const HOLD_START_GRACE_MS = 1500;
const FORM_BREAK_END_CONTINUOUS_MS = 7000;
const FORM_BREAK_END_COUNT = 5;

const WARN_FRAMES = 6;
const RESUME_FRAMES = 6;

// Slower re-fire so a lingering condition doesn't machine-gun the same nudge.
const WARNING_REPEAT_COOLDOWN_MS = 6000;
const TICK_INTERVAL_MS = 1000;

const POSITION_LOST_TIMEOUT_MS = 3000;
const POSITION_LOST_REPEAT_MS = 10_000;

const MIN_STREAK_BREAK_MS = 1000;

// Runtime distance nudge (owner request). Looser than calibration; sustained
// ~1 s before firing, then a long cooldown.
const RUNTIME_BODY_HEIGHT_MIN = 0.32;
const RUNTIME_BODY_HEIGHT_MAX = 1.05;
const RUNTIME_DISTANCE_DEBOUNCE_FRAMES = 45;
const RUNTIME_DISTANCE_COOLDOWN_MS = 12_000;

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

export class GatePoseEngine {
  private callbacks: GatePoseEngineCallbacks;
  private calibration: GatePoseCalibration;
  private baseline: GatePoseBaseline | null = null;

  private smoothedLeanDeg = 0;
  private smoothedTopArmAbove = 0;
  private smoothedFormScore = 100;
  private smoothInitialized = false;

  private bendPair = newPair();
  private topArmPair = newPair();

  private warningCooldowns: Partial<Record<WarningType, number>> = {};

  private runtimeDistanceBadFrames = 0;
  private lastDistanceWarnAt = 0;

  private holdStartAt: number | null = null;
  private lastTickAt = 0;
  private finished = false;
  private broken = false;

  // Terminal-rise debounce + forgiving form-break escalation.
  private shoulderRiseFrames = 0;
  private continuousFrozenMs = 0;
  private breakCount = 0;

  private accumulatedValidMs = 0;
  private lastFrameAt: number | null = null;
  private wasFormBroken = false;

  private longestUnfrozenStreakMs = 0;
  private currentStreakValidMs = 0;
  private streakBreakStartedAt = 0;
  private streakBreakCommitted = false;

  private lastValidFrameAt = 0;
  private lastPositionLostWarnAt = 0;

  constructor(callbacks: GatePoseEngineCallbacks = {}) {
    this.callbacks = callbacks;
    this.calibration = new GatePoseCalibration();
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
        debugLog('GATE', 'HOLD', 'Hold started', {
          bendSide: this.baseline?.bendSide,
          topArm: this.baseline?.topArm,
          shoulderWidth: this.baseline ? +this.baseline.shoulderWidth.toFixed(3) : null,
          initialLean: this.baseline ? +this.baseline.initialLeanDeg.toFixed(1) : null,
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
    const lw = landmarks[LM.LEFT_WRIST];
    const rw = landmarks[LM.RIGHT_WRIST];
    const lh = landmarks[LM.LEFT_HIP];
    const rh = landmarks[LM.RIGHT_HIP];
    const la = landmarks[LM.LEFT_ANKLE];
    const ra = landmarks[LM.RIGHT_ANKLE];

    // Terminal: user fully stood back up. Only on a SUSTAINED rise (debounced).
    const shoulderMid = midpoint(ls, rs);
    const shoulderRise = baseline.shoulderY - shoulderMid.y;
    this.shoulderRiseFrames = shoulderRise > HOLD_BROKEN_SHOULDER_RISE ? this.shoulderRiseFrames + 1 : 0;
    if (this.shoulderRiseFrames >= SHOULDER_RISE_DEBOUNCE_FRAMES) {
      this.fireHoldBroken('shoulder-rise', now, { shoulderRise });
      return;
    }

    // Runtime distance nudge.
    this.checkRuntimeDistance(ls, rs, la, ra, now);

    const refShoulderWidth = Math.max(baseline.shoulderWidth, MIN_SHOULDER_WIDTH_RUNTIME);
    void refShoulderWidth;

    // Raw per-frame metrics.
    const hipMid = midpoint(lh, rh);
    const rawLean = lateralLeanDeg(shoulderMid, hipMid);

    const topShoulder = baseline.topArm === 'left' ? ls : rs;
    const topWrist = baseline.topArm === 'left' ? lw : rw;
    const bhFloor = Math.max(baseline.bodyHeight, 0.10);
    const rawTopArmAbove = (topShoulder.y - topWrist.y) / bhFloor;

    // EMA smoothing — first frame seeds from raw; lean uses a per-frame clamp.
    if (!this.smoothInitialized) {
      this.smoothedLeanDeg = rawLean;
      this.smoothedTopArmAbove = rawTopArmAbove;
      this.smoothInitialized = true;
    } else {
      const clampedLean = clampLeanDelta(rawLean, this.smoothedLeanDeg);
      this.smoothedLeanDeg = SMOOTHING_ALPHA * clampedLean + (1 - SMOOTHING_ALPHA) * this.smoothedLeanDeg;
      this.smoothedTopArmAbove = SMOOTHING_ALPHA * rawTopArmAbove + (1 - SMOOTHING_ALPHA) * this.smoothedTopArmAbove;
    }

    // Per-frame bad flags.
    const bendBad = this.smoothedLeanDeg < MIN_BEND_HOLD_DEG;
    const topArmBad = this.smoothedTopArmAbove < TOP_ARM_HOLD_MIN;

    tickPair(this.bendPair, bendBad);
    tickPair(this.topArmPair, topArmBad);

    // Hold-start grace: let the user deepen into the bend without an instant
    // freeze (calibration now confirms at a slight lean).
    const inGrace = now - this.holdStartAt! < HOLD_START_GRACE_MS;
    const bendWarn = this.bendPair.active && !inGrace;
    const topArmWarn = this.topArmPair.active && !inGrace;

    this.maybeEmitWarning('incomplete-bend', bendWarn, now);
    this.maybeEmitWarning('arms-not-overhead', topArmWarn, now);

    // Form score.
    const bendPenalty = bendWarn
      ? Math.min(40, (MIN_BEND_HOLD_DEG - this.smoothedLeanDeg) * 2.5)
      : 0;
    const topArmPenalty = topArmWarn
      ? Math.min(30, (TOP_ARM_HOLD_MIN - this.smoothedTopArmAbove) * 300)
      : 0;
    const rawFormScore = Math.max(0, 100 - bendPenalty - topArmPenalty);
    this.smoothedFormScore = (1 - FORM_SMOOTH_ALPHA) * this.smoothedFormScore + FORM_SMOOTH_ALPHA * rawFormScore;

    // Fix B / Fix S — accumulate only frames where form is currently OK.
    const formBroken = bendWarn || topArmWarn;
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
      const reason = bendWarn ? 'incomplete-bend' : 'arms-not-overhead';
      debugLog('GATE', 'TIMER', 'frozen', {
        reason,
        breakCount: this.breakCount,
        accumulatedSec: +(this.accumulatedValidMs / 1000).toFixed(1),
      });
    } else if (!formBroken && this.wasFormBroken) {
      debugLog('GATE', 'TIMER', 'resumed', {
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

    const metrics: GatePoseFrameMetrics = {
      lateralLeanDeg: this.smoothedLeanDeg,
      topArmAbove: this.smoothedTopArmAbove,
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
      debugLog('GATE', 'TICK', `Tick ${secondsElapsed}s`, {
        mqs,
        lean: +this.smoothedLeanDeg.toFixed(1),
        topArm: +this.smoothedTopArmAbove.toFixed(3),
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
    const shoulderY = (ls.y + rs.y) / 2;
    const bottomY = Math.max(la.y, ra.y);
    const bodyHeight = bottomY - shoulderY;

    // Body-height only (NOT shoulderWidth) — the deep side-bend foreshortens the
    // shoulders, which would otherwise trip a false too-far mid-hold.
    let hint: WarningType | null = null;
    if (bodyHeight < RUNTIME_BODY_HEIGHT_MIN) {
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
    const distanceCueAllowed = this.lastDistanceWarnAt === 0
      || now - this.lastDistanceWarnAt >= RUNTIME_DISTANCE_COOLDOWN_MS;
    if (!distanceCueAllowed) return;
    this.lastDistanceWarnAt = now;
    debugLog('GATE', 'WARN', hint, { bodyHeight: +bodyHeight.toFixed(3) });
    this.callbacks.onPostureWarning?.(hint);
  }

  private fireHoldBroken(reason: string, now: number, extra: Record<string, unknown>): void {
    if (this.broken) return;
    this.broken = true;
    const atSec = this.holdStartAt ? Math.floor((now - this.holdStartAt) / 1000) : 0;
    debugLog('GATE', 'BROKEN', 'Hold ended early', { reason, atSec, ...extra });
    this.maybeEmitWarning('hold-broken', true, now);
    this.callbacks.onHoldBroken?.();
    this.finish();
  }

  private maybeEmitWarning(type: WarningType, active: boolean, now: number): void {
    if (!active) return;
    // Cold-start sentinel (Fix P): always allow the FIRST fire; the cooldown
    // only throttles re-fires.
    const last = this.warningCooldowns[type];
    if (last !== undefined && now - last < WARNING_REPEAT_COOLDOWN_MS) return;
    this.warningCooldowns[type] = now;
    debugLog('GATE', 'WARN', type);
    this.callbacks.onPostureWarning?.(type);
  }

  // ----------------------------------------------------------
  // Fix N — position-lost detection
  // ----------------------------------------------------------
  private hasCoreLandmarks(landmarks: PoseLandmarks): boolean {
    return lmVisible(landmarks[LM.LEFT_SHOULDER]) && lmVisible(landmarks[LM.RIGHT_SHOULDER])
      && lmVisible(landmarks[LM.LEFT_HIP]) && lmVisible(landmarks[LM.RIGHT_HIP])
      && lmVisible(landmarks[LM.LEFT_WRIST]) && lmVisible(landmarks[LM.RIGHT_WRIST])
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
    debugLog('GATE', 'WARN', 'position-lost', { lostMs: Math.round(lostMs) });
    this.callbacks.onPostureWarning?.('position-lost');
  }
}
