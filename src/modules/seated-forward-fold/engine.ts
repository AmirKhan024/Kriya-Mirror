/**
 * SeatedForwardFoldEngine (Paschimottanasana) — hold-based, side profile.
 *
 * No rep state machine. The user calibrates IN the pose (long-sitting, legs out
 * along the floor, torso folded forward over them), then holds it. Per frame the
 * engine computes one pure geometric angle from the camera-side shoulder / hip:
 *   foldAngle = torso angle from vertical (0° sitting tall, →90° folded over the legs).
 *
 * Emits:
 *   - onCalibrationUpdate while calibrating
 *   - onHoldTick({ secondsElapsed, mqs, longestUnfrozenSec }) once per second
 *   - onPostureWarning(type) with cooldown throttling
 *   - onHoldBroken() when the user sits back up (fold returns toward vertical)
 *
 * The single recoverable form-break (Fix S) FREEZES the hold counter but never
 * terminates:
 *   - not-folded-enough : the torso came up out of the fold
 * Only sitting fully back up (fold below STAND_BROKEN) terminates the hold.
 *
 * Knees are deliberately not gated — seated folds tolerate bent knees (tight
 * hamstrings), so a knee warning would be a false positive (like downward-dog).
 *
 * Mirrors standing-forward-fold's hold lifecycle: paired warn-state hysteresis
 * (Fix V), EMA α = 0.20 (Fix W), longest-streak debounce (Fix U), position-lost
 * detection (Fix N), TIMER frozen/resumed logs (Fix E).
 */
import type { PoseLandmarks } from '@/modules/pose/types';
import type { WarningType } from '@/store/workout';
import { LM, lmVisible, trunkLeanDeg } from '@/modules/squat/geometry';
import { SeatedForwardFoldCalibration } from './calibration';
import type { SeatedForwardFoldBaseline, SeatedForwardFoldEngineCallbacks, SeatedForwardFoldFrameMetrics } from './types';
import { getNotDeepPenalty } from './scoring';
import { debugLog } from '@/lib/debug';

// 2026-05-25 round 12 (Fix W): 0.20 — softer smoothing for noisy hold engines.
const EMA_ALPHA = 0.20;

// Fold thresholds (degrees of torso fold from vertical). 2026-06-02 physical-test
// fix (round 2): lowered to a comfortable "fingers-to-toes" depth. Probe logs show
// the owner's relaxed fold sits ~18–26°, so accumulate from 14° (won't freeze on a
// normal toe-touch hold) and only treat a near-upright torso (< 8°) as "sat up".
const FOLD_HOLD_MIN_DEG = 14;   // accumulate hold while folded at least this far
const STAND_BROKEN_DEG = 8;     // fold below this → user sat back up → hold-broken

// 2026-05-25 round 12 (Fix V): paired entry/exit hysteresis.
const NOT_DEEP_WARN_FRAMES = 6;
const NOT_DEEP_RESUME_FRAMES = 6;

const FORM_SMOOTH_ALPHA = 0.15;
const TICK_INTERVAL_MS = 1000;
const WARNING_REPEAT_COOLDOWN_MS = 2500;

// 2026-05-25 round 6 (Fix N): position-lost detection.
const POSITION_LOST_TIMEOUT_MS = 3000;
const POSITION_LOST_REPEAT_MS = 10_000;

// 2026-05-25 round 10 (Fix U): freeze blips shorter than this fold into the streak.
const MIN_STREAK_BREAK_MS = 1000;

export class SeatedForwardFoldEngine {
  private callbacks: SeatedForwardFoldEngineCallbacks;
  private calibration: SeatedForwardFoldCalibration;
  private baseline: SeatedForwardFoldBaseline | null = null;

  private smoothedFoldDeg = 0;
  private smoothedInitialized = false;
  private smoothedFormScore = 100;

  // Fix V: paired bad/good counters + sticky warn flag.
  private notDeepBadFrames = 0;
  private notDeepGoodFrames = 0;
  private notDeepWarnActive = false;

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

  constructor(callbacks: SeatedForwardFoldEngineCallbacks = {}) {
    this.callbacks = callbacks;
    this.calibration = new SeatedForwardFoldCalibration();
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
        debugLog('SFOLD', 'HOLD', 'Hold started', {
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

    const foldDeg = trunkLeanDeg({ x: shoulder.x, y: shoulder.y }, { x: hip.x, y: hip.y });

    if (!this.smoothedInitialized) {
      this.smoothedFoldDeg = foldDeg;
      this.smoothedInitialized = true;
    } else {
      this.smoothedFoldDeg = EMA_ALPHA * foldDeg + (1 - EMA_ALPHA) * this.smoothedFoldDeg;
    }

    // Hold broken: the user sat fully back up (fold angle returned toward
    // vertical). The only terminal condition — not-folded-enough is recoverable.
    if (this.smoothedFoldDeg < STAND_BROKEN_DEG) {
      this.fireHoldBroken('sat-up', now, { foldDeg: +this.smoothedFoldDeg.toFixed(1) });
      return;
    }

    // Recoverable form-break (came up out of the fold), paired hysteresis (Fix V).
    const notDeepBad = this.smoothedFoldDeg < FOLD_HOLD_MIN_DEG;
    this.notDeepBadFrames = notDeepBad ? this.notDeepBadFrames + 1 : 0;
    this.notDeepGoodFrames = notDeepBad ? 0 : this.notDeepGoodFrames + 1;
    if (!this.notDeepWarnActive && this.notDeepBadFrames >= NOT_DEEP_WARN_FRAMES) {
      this.notDeepWarnActive = true;
    } else if (this.notDeepWarnActive && this.notDeepGoodFrames >= NOT_DEEP_RESUME_FRAMES) {
      this.notDeepWarnActive = false;
    }
    const notDeepWarn = this.notDeepWarnActive;

    this.maybeEmitWarning('not-folded-enough', notDeepWarn, now);

    // Form score (smoothed).
    const rawFormScore = Math.max(0, 100 - getNotDeepPenalty(this.smoothedFoldDeg));
    this.smoothedFormScore = (1 - FORM_SMOOTH_ALPHA) * this.smoothedFormScore + FORM_SMOOTH_ALPHA * rawFormScore;

    // Fix B/S/E: accumulate only frames where form is currently OK; the warning
    // freezes the counter. The user recovers by deepening the fold again.
    const formBroken = notDeepWarn;
    const dtMs = this.lastFrameAt !== null ? now - this.lastFrameAt : 0;
    if (!formBroken && dtMs > 0 && dtMs < 200) {
      this.accumulatedValidMs += dtMs;
    }
    this.lastFrameAt = now;
    if (formBroken && !this.wasFormBroken) {
      debugLog('SFOLD', 'TIMER', 'frozen', {
        reason: 'not-folded-enough',
        accumulatedSec: +(this.accumulatedValidMs / 1000).toFixed(1),
      });
    } else if (!formBroken && this.wasFormBroken) {
      debugLog('SFOLD', 'TIMER', 'resumed', {
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
      debugLog('SFOLD', 'TICK', `Tick ${secondsElapsed}s`, {
        mqs,
        fold: +this.smoothedFoldDeg.toFixed(1),
        longestUnfrozenSec,
      });
      this.callbacks.onHoldTick?.({ secondsElapsed, mqs, longestUnfrozenSec });
    }
  }

  private fireHoldBroken(reason: string, now: number, extra: Record<string, unknown>): void {
    if (this.broken) return;
    this.broken = true;
    const atSec = this.holdStartAt ? Math.floor((now - this.holdStartAt) / 1000) : 0;
    debugLog('SFOLD', 'BROKEN', 'Hold ended early', { reason, atSec, ...extra });
    this.maybeEmitWarning('hold-broken', true, now);
    this.callbacks.onHoldBroken?.();
    this.finish();
  }

  private emitFrameMetrics(isHoldBroken: boolean): void {
    const metrics: SeatedForwardFoldFrameMetrics = {
      foldAngleDeg: this.smoothedFoldDeg,
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
    debugLog('SFOLD', 'WARN', type);
    this.callbacks.onPostureWarning?.(type);
  }

  // ----------------------------------------------------------
  // Fix N: position-lost detection
  // ----------------------------------------------------------

  /** Core set = the camera-side shoulder + hip + knee + ankle. */
  private hasCoreLandmarks(landmarks: PoseLandmarks): boolean {
    const side = this.baseline?.side;
    const check = (s: 'left' | 'right') =>
      lmVisible(landmarks[s === 'left' ? LM.LEFT_SHOULDER : LM.RIGHT_SHOULDER])
      && lmVisible(landmarks[s === 'left' ? LM.LEFT_HIP : LM.RIGHT_HIP])
      && lmVisible(landmarks[s === 'left' ? LM.LEFT_KNEE : LM.RIGHT_KNEE])
      && lmVisible(landmarks[s === 'left' ? LM.LEFT_ANKLE : LM.RIGHT_ANKLE]);
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
    debugLog('SFOLD', 'WARN', 'position-lost', { lostMs: Math.round(lostMs) });
    this.callbacks.onPostureWarning?.('position-lost');
  }
}
