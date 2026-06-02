/**
 * CobraPoseEngine (Bhujangasana) — hold-based, side-profile, prone backbend.
 *
 * No rep state machine. The user calibrates IN the pose (lying prone, chest
 * lifted), then holds it. Per frame the engine computes one pure geometric
 * angle from the camera-side shoulder / hip:
 *   elevation = the angle of the (shoulder → hip) segment above horizontal
 *               (~0° lying flat, rising as the chest lifts).
 *
 * Emits:
 *   - onCalibrationUpdate while calibrating
 *   - onHoldTick({ secondsElapsed, mqs, longestUnfrozenSec }) once per second
 *   - onPostureWarning(type) with cooldown throttling
 *   - onHoldBroken() when the user lays the chest back down to the floor
 *
 * The single recoverable form-break (Fix S) FREEZES the hold counter but never
 * terminates:
 *   - chest-not-lifted : the chest dropped below the hold threshold
 * Only laying fully flat (elevation below ELEV_REST) terminates the hold.
 *
 * Hips-off-floor is deliberately not tracked — that signal is small and
 * ankle-noisy, so we coach chest-lift only and avoid false positives.
 *
 * Mirrors standing-forward-fold's hold lifecycle: paired warn-state hysteresis
 * (Fix V), EMA α = 0.20 (Fix W), longest-streak debounce (Fix U), position-lost
 * detection (Fix N), TIMER frozen/resumed logs (Fix E).
 */
import type { PoseLandmarks } from '@/modules/pose/types';
import type { WarningType } from '@/store/workout';
import { LM, lmVisible } from '@/modules/squat/geometry';
import { CobraPoseCalibration } from './calibration';
import type { CobraPoseBaseline, CobraPoseEngineCallbacks, CobraPoseFrameMetrics } from './types';
import { getChestNotLiftedPenalty } from './scoring';
import { debugLog } from '@/lib/debug';

// 2026-05-25 round 12 (Fix W): 0.20 — softer smoothing for noisy hold engines.
const EMA_ALPHA = 0.20;

// Torso elevation thresholds (degrees above horizontal).
const ELEV_HOLD_MIN = 14;   // accumulate valid hold while elevation ≥ this
const ELEV_REST = 6;        // elevation below this → chest laid flat → hold-broken

// 2026-05-25 round 12 (Fix V): paired entry/exit hysteresis so MediaPipe
// single-frame jitter can't chatter the timer freeze on/off.
const CHEST_WARN_FRAMES = 6;
const CHEST_RESUME_FRAMES = 6;

const FORM_SMOOTH_ALPHA = 0.15;
const TICK_INTERVAL_MS = 1000;
const WARNING_REPEAT_COOLDOWN_MS = 2500;

// 2026-05-25 round 6 (Fix N): position-lost detection.
const POSITION_LOST_TIMEOUT_MS = 3000;
const POSITION_LOST_REPEAT_MS = 10_000;

// 2026-05-25 round 10 (Fix U): a freeze blip shorter than this is absorbed into
// the ongoing longest-hold streak rather than ending it.
const MIN_STREAK_BREAK_MS = 1000;

/** Torso elevation: angle of the (shoulder → hip) segment above horizontal. */
function torsoElevationDeg(
  shoulder: { x: number; y: number },
  hip: { x: number; y: number },
): number {
  const rise = hip.y - shoulder.y;            // > 0 when shoulder is above hip
  const run = Math.abs(shoulder.x - hip.x);
  return Math.atan2(rise, Math.max(run, 1e-6)) * (180 / Math.PI);
}

export class CobraPoseEngine {
  private callbacks: CobraPoseEngineCallbacks;
  private calibration: CobraPoseCalibration;
  private baseline: CobraPoseBaseline | null = null;

  private smoothedElevDeg = 0;
  private smoothedInitialized = false;
  private smoothedFormScore = 100;

  // Fix V: paired bad/good counters + sticky warn flag.
  private chestBadFrames = 0;
  private chestGoodFrames = 0;
  private chestWarnActive = false;

  private warningCooldowns: Partial<Record<WarningType, number>> = {};

  private holdStartAt: number | null = null;
  private lastTickAt = 0;
  private finished = false;
  private broken = false;

  // Fix S/B: freeze the hold counter during the recoverable form-break.
  private accumulatedValidMs = 0;
  private lastFrameAt: number | null = null;
  private wasFormBroken = false;

  // Fix U: longest continuous unfrozen-form streak (ms), 1 s break debounce.
  private longestUnfrozenStreakMs = 0;
  private currentStreakValidMs = 0;
  private streakBreakStartedAt = 0;
  private streakBreakCommitted = false;

  // Fix N: position-lost heartbeat.
  private lastValidFrameAt = 0;
  private lastPositionLostWarnAt = 0;

  constructor(callbacks: CobraPoseEngineCallbacks = {}) {
    this.callbacks = callbacks;
    this.calibration = new CobraPoseCalibration();
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
        debugLog('COBRA', 'HOLD', 'Hold started', {
          side: this.baseline?.side,
          bodyLengthX: this.baseline ? +this.baseline.bodyLengthX.toFixed(3) : null,
        });
      }
      return;
    }

    // Fix N: position-lost check runs regardless of whether this frame is usable.
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
    const side = baseline.side;

    const shoulder = landmarks[side === 'left' ? LM.LEFT_SHOULDER : LM.RIGHT_SHOULDER];
    const hip = landmarks[side === 'left' ? LM.LEFT_HIP : LM.RIGHT_HIP];

    if (!lmVisible(shoulder) || !lmVisible(hip)) return;

    const elevDeg = torsoElevationDeg({ x: shoulder.x, y: shoulder.y }, { x: hip.x, y: hip.y });

    if (!this.smoothedInitialized) {
      this.smoothedElevDeg = elevDeg;
      this.smoothedInitialized = true;
    } else {
      this.smoothedElevDeg = EMA_ALPHA * elevDeg + (1 - EMA_ALPHA) * this.smoothedElevDeg;
    }

    // Hold broken: the chest laid back down to the floor (elevation near zero).
    // The only terminal condition — chest-not-lifted below is recoverable.
    if (this.smoothedElevDeg < ELEV_REST) {
      this.fireHoldBroken('rested', now, { elevDeg: +this.smoothedElevDeg.toFixed(1) });
      return;
    }

    // Recoverable form-break (chest dropped), with paired entry/exit hysteresis (Fix V).
    const chestBad = this.smoothedElevDeg < ELEV_HOLD_MIN;
    this.chestBadFrames = chestBad ? this.chestBadFrames + 1 : 0;
    this.chestGoodFrames = chestBad ? 0 : this.chestGoodFrames + 1;
    if (!this.chestWarnActive && this.chestBadFrames >= CHEST_WARN_FRAMES) {
      this.chestWarnActive = true;
    } else if (this.chestWarnActive && this.chestGoodFrames >= CHEST_RESUME_FRAMES) {
      this.chestWarnActive = false;
    }
    const chestWarn = this.chestWarnActive;

    this.maybeEmitWarning('chest-not-lifted', chestWarn, now);

    // Form score (smoothed).
    const rawFormScore = Math.max(0, 100 - getChestNotLiftedPenalty(this.smoothedElevDeg));
    this.smoothedFormScore = (1 - FORM_SMOOTH_ALPHA) * this.smoothedFormScore + FORM_SMOOTH_ALPHA * rawFormScore;

    // Fix B/S/E: accumulate only frames where form is currently OK; the
    // chest-not-lifted warning freezes the counter. The user recovers by
    // lifting the chest again.
    const formBroken = chestWarn;
    const dtMs = this.lastFrameAt !== null ? now - this.lastFrameAt : 0;
    if (!formBroken && dtMs > 0 && dtMs < 200) {
      this.accumulatedValidMs += dtMs;
    }
    this.lastFrameAt = now;
    if (formBroken && !this.wasFormBroken) {
      debugLog('COBRA', 'TIMER', 'frozen', {
        reason: 'chest-not-lifted',
        accumulatedSec: +(this.accumulatedValidMs / 1000).toFixed(1),
      });
    } else if (!formBroken && this.wasFormBroken) {
      debugLog('COBRA', 'TIMER', 'resumed', {
        accumulatedSec: +(this.accumulatedValidMs / 1000).toFixed(1),
      });
    }
    this.wasFormBroken = formBroken;

    // Fix U: longest-streak accounting with 1 s break debounce.
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

    this.emitFrameMetrics(false);

    // 1Hz tick — secondsElapsed reflects VALID hold time, not wall-clock.
    if (now - this.lastTickAt >= TICK_INTERVAL_MS) {
      this.lastTickAt = now;
      const secondsElapsed = Math.floor(this.accumulatedValidMs / 1000);
      const mqs = Math.round(this.smoothedFormScore);
      const longestUnfrozenSec = Math.max(
        Math.floor(this.longestUnfrozenStreakMs / 1000),
        Math.floor(this.currentStreakValidMs / 1000),
      );
      debugLog('COBRA', 'TICK', `Tick ${secondsElapsed}s`, {
        mqs,
        elev: +this.smoothedElevDeg.toFixed(1),
        longestUnfrozenSec,
      });
      this.callbacks.onHoldTick?.({ secondsElapsed, mqs, longestUnfrozenSec });
    }
  }

  private fireHoldBroken(reason: string, now: number, extra: Record<string, unknown>): void {
    if (this.broken) return;
    this.broken = true;
    const atSec = this.holdStartAt ? Math.floor((now - this.holdStartAt) / 1000) : 0;
    debugLog('COBRA', 'BROKEN', 'Hold ended early', { reason, atSec, ...extra });
    this.maybeEmitWarning('hold-broken', true, now);
    this.callbacks.onHoldBroken?.();
    this.finish();
  }

  private emitFrameMetrics(isHoldBroken: boolean): void {
    const metrics: CobraPoseFrameMetrics = {
      elevationDeg: this.smoothedElevDeg,
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
    debugLog('COBRA', 'WARN', type);
    this.callbacks.onPostureWarning?.(type);
  }

  // ----------------------------------------------------------
  // Fix N: position-lost detection
  // ----------------------------------------------------------

  /** Core set = the camera-side shoulder + hip (the landmarks processHoldFrame
   *  needs). */
  private hasCoreLandmarks(landmarks: PoseLandmarks): boolean {
    const side = this.baseline?.side;
    const check = (s: 'left' | 'right') =>
      lmVisible(landmarks[s === 'left' ? LM.LEFT_SHOULDER : LM.RIGHT_SHOULDER])
      && lmVisible(landmarks[s === 'left' ? LM.LEFT_HIP : LM.RIGHT_HIP]);
    if (side) return check(side);
    return check('left') || check('right');
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
    debugLog('COBRA', 'WARN', 'position-lost', { lostMs: Math.round(lostMs) });
    this.callbacks.onPostureWarning?.('position-lost');
  }
}
