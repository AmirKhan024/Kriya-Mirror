/**
 * MountainPoseEngine — hold-based posture-stillness tracker for Tadasana.
 *
 * Front-facing camera, feet together, arms reaching overhead. The engine
 * rewards stillness (low sway) + posture alignment (shoulders level, hips
 * level, spine vertical) + the user maintaining arms overhead. Warnings
 * (all Fix S — freeze timer, don't terminate):
 *
 *   - `swaying`              — CoM displacement > 6° (round 20 tuning)
 *   - `posture-not-aligned`  — combined alignment deviation > 0.45 (round 20)
 *   - `arms-not-overhead`    — both wrists must stay above both shoulders
 *
 * Only shoulder-rise (user steps away or sits) terminates.
 *
 * Round 19 added a calf-raise (heels lifted) layer; round 20 rolled it back
 * per user direction — pose is now just feet-together + arms-overhead.
 */
import type { PoseLandmarks } from '@/modules/pose/types';
import type { WarningType } from '@/store/workout';
import { LM, lmVisible, comProxy } from './geometry';
import { MountainPoseCalibration } from './calibration';
import type { MountainPoseBaseline, MountainPoseEngineCallbacks, MountainPoseFrameMetrics } from './types';
import { getPosturePenalty, getSwayPenalty } from './scoring';
import { debugLog } from '@/lib/debug';

// Fix W — aggressive EMA smoothing for hold-based MediaPipe noise.
const SMOOTHING_ALPHA = 0.20;
// Long baseline capture to stabilize the CoM reference (per SLS round-15 rationale).
const HOLD_BASELINE_FRAMES = 30;

// 2026-05-28 round 20: heel-rise dropped per user direction (Tadasana variant
// is now just feet-together + arms-overhead, no calf raise). Sway threshold
// tuned to 6° — natural standing sway with both feet flat is small (~2-4°),
// 6° gives comfortable margin above noise while still catching balance issues.
// (Was 8° in round 19 to accommodate the calf-raise base of support.)
const SWAY_WARN_ANGLE_DEG = 6;
const SWAY_WARN_FRAMES = 6;
const SWAY_RESUME_FRAMES = 6;

// Combined alignment deviation threshold (Fix V hysteresis on top).
// 2026-05-28 round 20: bumped 0.30 → 0.45 to absorb natural anatomical
// asymmetry (1-2 cm shoulder/hip Y offsets are normal and sum to ~0.15-0.30
// against shoulderWidth; old threshold was at the noise ceiling and fired
// constantly). 0.45 keeps ~50% headroom above typical human variance.
const POSTURE_DEVIATION_THRESHOLD = 0.45;
const POSTURE_WARN_FRAMES = 6;
const POSTURE_RESUME_FRAMES = 6;

// Arms-overhead runtime gate (kept from round 19 — still part of the pose).
const ARMS_OVERHEAD_Y_MARGIN = 0.05;     // wrist Y < shoulder Y − this = arms overhead
const ARMS_DROPPED_WARN_FRAMES = 6;
const ARMS_DROPPED_RESUME_FRAMES = 6;

const HOLD_BROKEN_SHOULDER_RISE = 0.15;

const FORM_SMOOTH_ALPHA = 0.15;
const TICK_INTERVAL_MS = 1000;
const WARNING_REPEAT_COOLDOWN_MS = 2500;

// Fix N — position-lost detection.
const POSITION_LOST_TIMEOUT_MS = 3000;
const POSITION_LOST_REPEAT_MS = 10_000;

// 2026-05-28 round 20: idle / not-moving prompt while the user is out of the
// pose. Fires when form has been broken (timer frozen) for ≥ 5 s, then repeats
// every 15 s. Re-arms once form recovers.
const NOT_MOVING_TIMEOUT_MS = 5000;
const NOT_MOVING_REPEAT_MS = 15_000;

// Fix U — longest-streak debounce.
const MIN_STREAK_BREAK_MS = 1000;

// Fix X — runtime shoulderWidth floor.
const MIN_SHOULDER_WIDTH_RUNTIME = 0.08;

export class MountainPoseEngine {
  private callbacks: MountainPoseEngineCallbacks;
  private calibration: MountainPoseCalibration;
  private baseline: MountainPoseBaseline | null = null;

  private smoothedComX = 0;
  private smoothedComY = 0;
  private smoothedComInitialized = false;

  private holdBaselineComX: number | null = null;
  private holdBaselineComY: number | null = null;
  private holdBaselineFrames: Array<{ x: number; y: number }> = [];

  // Smoothed posture deviation (combined alignment metric).
  private smoothedPostureDeviation = 0;
  private smoothedPostureInitialized = false;

  private smoothedFormScore = 100;

  // Fix V — paired entry/exit hysteresis for each warning.
  private swayBadFrames = 0;
  private swayGoodFrames = 0;
  private swayWarnActive = false;
  private postureBadFrames = 0;
  private postureGoodFrames = 0;
  private postureWarnActive = false;

  // Arms-overhead runtime hysteresis pair (round 19; round 20 dropped heels).
  private armsDroppedBadFrames = 0;
  private armsDroppedGoodFrames = 0;
  private armsDroppedWarnActive = false;

  private warningCooldowns: Partial<Record<WarningType, number>> = {};

  private holdStartAt: number | null = null;
  private lastTickAt = 0;
  private finished = false;
  private broken = false;

  // Fix B — accumulator freezes during sustained bad form.
  private accumulatedValidMs = 0;
  private lastFrameAt: number | null = null;
  private wasFormBroken = false;

  // Fix U — longest-streak with 1 s debounce.
  private longestUnfrozenStreakMs = 0;
  private currentStreakValidMs = 0;
  private streakBreakStartedAt = 0;
  private streakBreakCommitted = false;

  // Fix N — position-lost heartbeat.
  private lastValidFrameAt = 0;
  private lastPositionLostWarnAt = 0;

  // Round 20 — idle/not-moving while out of pose.
  private formBrokenSince: number | null = null;
  private lastNotMovingWarnAt = 0;

  constructor(callbacks: MountainPoseEngineCallbacks = {}) {
    this.callbacks = callbacks;
    this.calibration = new MountainPoseCalibration();
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
        debugLog('MOUNTAIN', 'HOLD', 'Hold started', {
          shoulderWidth: this.baseline ? +this.baseline.shoulderWidth.toFixed(3) : null,
        });
      }
      return;
    }

    // Fix N — position-lost check before landmark-null early return.
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
    const lw = landmarks[LM.LEFT_WRIST];
    const rw = landmarks[LM.RIGHT_WRIST];

    if (!lmVisible(ls) || !lmVisible(rs) || !lmVisible(lh) || !lmVisible(rh)) return;
    // Wrists also required for the arms-overhead runtime check.
    if (!lmVisible(lw) || !lmVisible(rw)) return;

    // Terminal: user stepped away (shoulder rose vs cal).
    const shoulderY = (ls.y + rs.y) / 2;
    const shoulderRise = baseline.shoulderY - shoulderY;
    if (shoulderRise > HOLD_BROKEN_SHOULDER_RISE) {
      this.fireHoldBroken('shoulder-rise', now, { shoulderRise });
      return;
    }

    const refShoulderWidth = Math.max(baseline.shoulderWidth, MIN_SHOULDER_WIDTH_RUNTIME);

    // Per-frame CoM proxy + EMA smoothing.
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
        debugLog('MOUNTAIN', 'HOLD', 'Hold baseline captured', {
          baselineX: +meanX.toFixed(3),
          baselineY: +meanY.toFixed(3),
        });
      }
      this.emitFrameMetrics(0, 0, 0, false);
      return;
    }

    // Sway displacement (distance-independent via shoulder-width).
    const baseComX = this.holdBaselineComX;
    const baseComY = this.holdBaselineComY!;
    const dx = this.smoothedComX - baseComX;
    const dy = this.smoothedComY - baseComY;
    const rawDisplacement = Math.hypot(dx, dy) / refShoulderWidth;
    const swayAngleDeg = Math.atan2(rawDisplacement, 1.0) * (180 / Math.PI);

    // Posture deviation: shoulder levelness + hip levelness + spine verticality.
    const shoulderLevelness = Math.abs(ls.y - rs.y) / refShoulderWidth;
    const hipLevelness = Math.abs(lh.y - rh.y) / refShoulderWidth;
    const shoulderMidX = (ls.x + rs.x) / 2;
    const hipMidX = (lh.x + rh.x) / 2;
    const spineVerticalDeviation = Math.abs(shoulderMidX - hipMidX) / refShoulderWidth;
    const rawPostureDeviation = shoulderLevelness + hipLevelness + spineVerticalDeviation;

    if (!this.smoothedPostureInitialized) {
      this.smoothedPostureDeviation = rawPostureDeviation;
      this.smoothedPostureInitialized = true;
    } else {
      this.smoothedPostureDeviation = SMOOTHING_ALPHA * rawPostureDeviation
        + (1 - SMOOTHING_ALPHA) * this.smoothedPostureDeviation;
    }

    // Fix V — paired entry/exit hysteresis.
    const swayBad = swayAngleDeg > SWAY_WARN_ANGLE_DEG;
    this.swayBadFrames = swayBad ? this.swayBadFrames + 1 : 0;
    this.swayGoodFrames = swayBad ? 0 : this.swayGoodFrames + 1;
    if (!this.swayWarnActive && this.swayBadFrames >= SWAY_WARN_FRAMES) {
      this.swayWarnActive = true;
    } else if (this.swayWarnActive && this.swayGoodFrames >= SWAY_RESUME_FRAMES) {
      this.swayWarnActive = false;
    }

    const postureBad = this.smoothedPostureDeviation > POSTURE_DEVIATION_THRESHOLD;
    this.postureBadFrames = postureBad ? this.postureBadFrames + 1 : 0;
    this.postureGoodFrames = postureBad ? 0 : this.postureGoodFrames + 1;
    if (!this.postureWarnActive && this.postureBadFrames >= POSTURE_WARN_FRAMES) {
      this.postureWarnActive = true;
    } else if (this.postureWarnActive && this.postureGoodFrames >= POSTURE_RESUME_FRAMES) {
      this.postureWarnActive = false;
    }

    // Arms-overhead runtime check. Both wrists must stay clearly above both
    // shoulders during the hold.
    const armsOverheadStill = lw.y < ls.y - ARMS_OVERHEAD_Y_MARGIN
                           && rw.y < rs.y - ARMS_OVERHEAD_Y_MARGIN;
    const armsDroppedBad = !armsOverheadStill;
    this.armsDroppedBadFrames = armsDroppedBad ? this.armsDroppedBadFrames + 1 : 0;
    this.armsDroppedGoodFrames = armsDroppedBad ? 0 : this.armsDroppedGoodFrames + 1;
    if (!this.armsDroppedWarnActive && this.armsDroppedBadFrames >= ARMS_DROPPED_WARN_FRAMES) {
      this.armsDroppedWarnActive = true;
    } else if (this.armsDroppedWarnActive && this.armsDroppedGoodFrames >= ARMS_DROPPED_RESUME_FRAMES) {
      this.armsDroppedWarnActive = false;
    }

    const swayWarn = this.swayWarnActive;
    const postureWarn = this.postureWarnActive;
    const armsDroppedWarn = this.armsDroppedWarnActive;

    this.maybeEmitWarning('swaying', swayWarn, now);
    this.maybeEmitWarning('posture-not-aligned', postureWarn, now);
    this.maybeEmitWarning('arms-not-overhead', armsDroppedWarn, now);

    // Form score
    const swayPen = getSwayPenalty(swayAngleDeg);
    const posturePen = getPosturePenalty(this.smoothedPostureDeviation);
    const rawFormScore = Math.max(0, 100 - swayPen - posturePen);
    this.smoothedFormScore = (1 - FORM_SMOOTH_ALPHA) * this.smoothedFormScore + FORM_SMOOTH_ALPHA * rawFormScore;

    // Fix B — accumulate only frames where form is currently OK. All three
    // warnings are structural (Fix S — recoverable but freeze the timer).
    const formBroken = swayWarn || postureWarn || armsDroppedWarn;
    const dtMs = this.lastFrameAt !== null ? now - this.lastFrameAt : 0;
    if (!formBroken && dtMs > 0 && dtMs < 200) {
      this.accumulatedValidMs += dtMs;
    }
    this.lastFrameAt = now;

    // Fix E — TIMER frozen/resumed debug logs on freeze edges.
    if (formBroken && !this.wasFormBroken) {
      const reason = armsDroppedWarn ? 'arms-not-overhead'
        : postureWarn ? 'posture-not-aligned'
          : 'swaying';
      debugLog('MOUNTAIN', 'TIMER', 'frozen', {
        reason,
        accumulatedSec: +(this.accumulatedValidMs / 1000).toFixed(1),
      });
    } else if (!formBroken && this.wasFormBroken) {
      debugLog('MOUNTAIN', 'TIMER', 'resumed', {
        accumulatedSec: +(this.accumulatedValidMs / 1000).toFixed(1),
      });
    }
    this.wasFormBroken = formBroken;

    // Round 20 — fire `not-moving` if the user has been out of pose for ≥ 5 s.
    // Repeats every 15 s while still broken. Resets when form recovers.
    if (formBroken) {
      if (this.formBrokenSince === null) this.formBrokenSince = now;
      const brokenFor = now - this.formBrokenSince;
      const sinceLast = this.lastNotMovingWarnAt > 0
        ? now - this.lastNotMovingWarnAt
        : Infinity;
      if (brokenFor >= NOT_MOVING_TIMEOUT_MS && sinceLast >= NOT_MOVING_REPEAT_MS) {
        // Bypass the chip-cooldown — this is the cross-cutting idle nudge.
        this.callbacks.onPostureWarning?.('not-moving');
        this.lastNotMovingWarnAt = now;
        debugLog('MOUNTAIN', 'WARN', 'not-moving', { brokenForMs: brokenFor });
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

    this.emitFrameMetrics(swayAngleDeg, rawDisplacement, this.smoothedPostureDeviation, false);

    // 1 Hz tick.
    if (now - this.lastTickAt >= TICK_INTERVAL_MS) {
      this.lastTickAt = now;
      const secondsElapsed = Math.floor(this.accumulatedValidMs / 1000);
      const mqs = Math.round(this.smoothedFormScore);
      const longestUnfrozenSec = Math.max(
        Math.floor(this.longestUnfrozenStreakMs / 1000),
        Math.floor(this.currentStreakValidMs / 1000),
      );
      debugLog('MOUNTAIN', 'TICK', `Tick ${secondsElapsed}s`, {
        mqs,
        sway: +swayAngleDeg.toFixed(2),
        posture: +this.smoothedPostureDeviation.toFixed(3),
        longestUnfrozenSec,
      });
      this.callbacks.onHoldTick?.({ secondsElapsed, mqs, longestUnfrozenSec });
    }
  }

  private fireHoldBroken(reason: string, now: number, extra: Record<string, unknown>): void {
    if (this.broken) return;
    this.broken = true;
    const atSec = this.holdStartAt ? Math.floor((now - this.holdStartAt) / 1000) : 0;
    debugLog('MOUNTAIN', 'BROKEN', 'Hold ended early', { reason, atSec, ...extra });
    this.maybeEmitWarning('hold-broken', true, now);
    this.callbacks.onHoldBroken?.();
    this.finish();
  }

  private emitFrameMetrics(
    swayAngleDeg: number,
    swayDisplacement: number,
    postureDeviation: number,
    isHoldBroken: boolean,
  ): void {
    const metrics: MountainPoseFrameMetrics = {
      swayAngleDeg,
      swayDisplacement,
      postureDeviation,
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
    debugLog('MOUNTAIN', 'WARN', type);
    this.callbacks.onPostureWarning?.(type);
  }

  // ----------------------------------------------------------
  // Fix N — position-lost detection
  // ----------------------------------------------------------
  private hasCoreLandmarks(landmarks: PoseLandmarks): boolean {
    return lmVisible(landmarks[LM.LEFT_SHOULDER]) && lmVisible(landmarks[LM.RIGHT_SHOULDER])
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
    debugLog('MOUNTAIN', 'WARN', 'position-lost', { lostMs: Math.round(lostMs) });
    this.callbacks.onPostureWarning?.('position-lost');
  }
}
