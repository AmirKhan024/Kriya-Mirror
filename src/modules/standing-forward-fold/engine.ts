/**
 * StandingForwardFoldEngine (Uttanasana) — hold-based, side-profile.
 *
 * No rep state machine. The user calibrates IN the folded pose, then holds it.
 * Per frame the engine computes two pure geometric angles from the camera-side
 * shoulder / hip / knee / ankle:
 *   - foldAngle   = torso angle from vertical (0 = upright, 90 = horizontal hinge)
 *   - kneeFlexion = how bent the legs are (the fold is a hip hinge — legs stay near-straight)
 *
 * Emits:
 *   - onCalibrationUpdate while calibrating
 *   - onHoldTick({ secondsElapsed, mqs, longestUnfrozenSec }) once per second
 *   - onPostureWarning(type) with cooldown throttling
 *   - onHoldBroken() when the user stands back up (fold angle returns toward vertical)
 *
 * Recoverable form-breaks (Fix S) FREEZE the hold counter but never terminate:
 *   - not-folded-enough : fold angle dipped below the hold threshold
 *   - leg-not-straight  : knees bent past the straight-leg threshold
 * Only standing fully up terminates the hold.
 *
 * Mirrors single-leg-stand's hold lifecycle: paired warn-state hysteresis
 * (Fix V), EMA α = 0.20 (Fix W), longest-streak debounce (Fix U), position-lost
 * detection (Fix N), TIMER frozen/resumed logs (Fix E).
 */
import type { PoseLandmarks } from '@/modules/pose/types';
import type { WarningType } from '@/store/workout';
import { LM, lmVisible, trunkLeanDeg, kneeFlexionDeg } from '@/modules/squat/geometry';
import { ForwardFoldCalibration } from './calibration';
import type { ForwardFoldBaseline, ForwardFoldEngineCallbacks, ForwardFoldFrameMetrics } from './types';
import { getNotDeepPenalty, getKneeBentPenalty } from './scoring';
import { debugLog } from '@/lib/debug';

// 2026-05-25 round 12 (Fix W): 0.20 — softer smoothing for noisy hold engines.
const EMA_ALPHA = 0.20;

// Fold thresholds (degrees of torso fold from vertical).
const FOLD_HOLD_MIN_DEG = 50;   // accumulate hold only when folded at least this far
const STAND_BROKEN_DEG = 30;    // fold angle below this → user stood up → hold-broken

// Knee gate: a forward fold is a hip hinge — legs stay near-straight.
const KNEE_BENT_DEG = 35;

// 2026-05-25 round 12 (Fix V): paired entry/exit hysteresis so MediaPipe
// single-frame jitter can't chatter the timer freeze on/off.
const NOT_DEEP_WARN_FRAMES = 6;
const NOT_DEEP_RESUME_FRAMES = 6;
const KNEE_BENT_WARN_FRAMES = 6;
const KNEE_BENT_RESUME_FRAMES = 6;

const FORM_SMOOTH_ALPHA = 0.15;
const TICK_INTERVAL_MS = 1000;
const WARNING_REPEAT_COOLDOWN_MS = 2500;

// 2026-05-25 round 6 (Fix N): position-lost — fire if no usable pose frame for
// ≥ 3 s post-cal, repeat every 10 s while still lost.
const POSITION_LOST_TIMEOUT_MS = 3000;
const POSITION_LOST_REPEAT_MS = 10_000;

// 2026-05-25 round 10 (Fix U): a freeze blip shorter than this is absorbed into
// the ongoing longest-hold streak rather than ending it.
const MIN_STREAK_BREAK_MS = 1000;

export class StandingForwardFoldEngine {
  private callbacks: ForwardFoldEngineCallbacks;
  private calibration: ForwardFoldCalibration;
  private baseline: ForwardFoldBaseline | null = null;

  private smoothedFoldDeg = 0;
  private smoothedKneeDeg = 0;
  private smoothedInitialized = false;
  private smoothedFormScore = 100;

  // Fix V: paired bad/good counters + sticky warn flags.
  private notDeepBadFrames = 0;
  private notDeepGoodFrames = 0;
  private notDeepWarnActive = false;
  private kneeBentBadFrames = 0;
  private kneeBentGoodFrames = 0;
  private kneeBentWarnActive = false;

  private warningCooldowns: Partial<Record<WarningType, number>> = {};

  private holdStartAt: number | null = null;
  private lastTickAt = 0;
  private finished = false;
  private broken = false;

  // Fix S/B: freeze the hold counter during recoverable form-breaks.
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

  constructor(callbacks: ForwardFoldEngineCallbacks = {}) {
    this.callbacks = callbacks;
    this.calibration = new ForwardFoldCalibration();
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
        debugLog('FOLD', 'HOLD', 'Hold started', {
          side: this.baseline?.side,
          bodyHeightY: this.baseline ? +this.baseline.bodyHeightY.toFixed(3) : null,
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
    const knee = landmarks[side === 'left' ? LM.LEFT_KNEE : LM.RIGHT_KNEE];
    const ankle = landmarks[side === 'left' ? LM.LEFT_ANKLE : LM.RIGHT_ANKLE];

    if (!lmVisible(shoulder) || !lmVisible(hip) || !lmVisible(knee) || !lmVisible(ankle)) return;

    const foldDeg = trunkLeanDeg({ x: shoulder.x, y: shoulder.y }, { x: hip.x, y: hip.y });
    const kneeDeg = kneeFlexionDeg(hip, knee, ankle);

    if (!this.smoothedInitialized) {
      this.smoothedFoldDeg = foldDeg;
      this.smoothedKneeDeg = kneeDeg;
      this.smoothedInitialized = true;
    } else {
      this.smoothedFoldDeg = EMA_ALPHA * foldDeg + (1 - EMA_ALPHA) * this.smoothedFoldDeg;
      this.smoothedKneeDeg = EMA_ALPHA * kneeDeg + (1 - EMA_ALPHA) * this.smoothedKneeDeg;
    }

    // Hold broken: the user stood fully back up (fold angle returned toward
    // vertical). The only terminal condition — every form-break below is
    // recoverable.
    if (this.smoothedFoldDeg < STAND_BROKEN_DEG) {
      this.fireHoldBroken('stood-up', now, { foldDeg: +this.smoothedFoldDeg.toFixed(1) });
      return;
    }

    // Recoverable form-breaks, with paired entry/exit hysteresis (Fix V).
    const notDeepBad = this.smoothedFoldDeg < FOLD_HOLD_MIN_DEG;
    this.notDeepBadFrames = notDeepBad ? this.notDeepBadFrames + 1 : 0;
    this.notDeepGoodFrames = notDeepBad ? 0 : this.notDeepGoodFrames + 1;
    if (!this.notDeepWarnActive && this.notDeepBadFrames >= NOT_DEEP_WARN_FRAMES) {
      this.notDeepWarnActive = true;
    } else if (this.notDeepWarnActive && this.notDeepGoodFrames >= NOT_DEEP_RESUME_FRAMES) {
      this.notDeepWarnActive = false;
    }

    const kneeBentBad = this.smoothedKneeDeg > KNEE_BENT_DEG;
    this.kneeBentBadFrames = kneeBentBad ? this.kneeBentBadFrames + 1 : 0;
    this.kneeBentGoodFrames = kneeBentBad ? 0 : this.kneeBentGoodFrames + 1;
    if (!this.kneeBentWarnActive && this.kneeBentBadFrames >= KNEE_BENT_WARN_FRAMES) {
      this.kneeBentWarnActive = true;
    } else if (this.kneeBentWarnActive && this.kneeBentGoodFrames >= KNEE_BENT_RESUME_FRAMES) {
      this.kneeBentWarnActive = false;
    }

    const notDeepWarn = this.notDeepWarnActive;
    const kneeBentWarn = this.kneeBentWarnActive;

    this.maybeEmitWarning('not-folded-enough', notDeepWarn, now);
    this.maybeEmitWarning('leg-not-straight', kneeBentWarn, now);

    // Form score (smoothed).
    const notDeepPen = getNotDeepPenalty(this.smoothedFoldDeg);
    const kneeBentPen = getKneeBentPenalty(this.smoothedKneeDeg);
    const rawFormScore = Math.max(0, 100 - notDeepPen - kneeBentPen);
    this.smoothedFormScore = (1 - FORM_SMOOTH_ALPHA) * this.smoothedFormScore + FORM_SMOOTH_ALPHA * rawFormScore;

    // Fix B/S/E: accumulate only frames where form is currently OK; both warnings
    // freeze the counter. The user recovers by deepening the fold / straightening.
    const formBroken = notDeepWarn || kneeBentWarn;
    const dtMs = this.lastFrameAt !== null ? now - this.lastFrameAt : 0;
    if (!formBroken && dtMs > 0 && dtMs < 200) {
      this.accumulatedValidMs += dtMs;
    }
    this.lastFrameAt = now;
    if (formBroken && !this.wasFormBroken) {
      const reason = kneeBentWarn ? 'leg-not-straight' : 'not-folded-enough';
      debugLog('FOLD', 'TIMER', 'frozen', {
        reason,
        accumulatedSec: +(this.accumulatedValidMs / 1000).toFixed(1),
      });
    } else if (!formBroken && this.wasFormBroken) {
      debugLog('FOLD', 'TIMER', 'resumed', {
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
      debugLog('FOLD', 'TICK', `Tick ${secondsElapsed}s`, {
        mqs,
        fold: +this.smoothedFoldDeg.toFixed(1),
        knee: +this.smoothedKneeDeg.toFixed(1),
        longestUnfrozenSec,
      });
      this.callbacks.onHoldTick?.({ secondsElapsed, mqs, longestUnfrozenSec });
    }
  }

  private fireHoldBroken(reason: string, now: number, extra: Record<string, unknown>): void {
    if (this.broken) return;
    this.broken = true;
    const atSec = this.holdStartAt ? Math.floor((now - this.holdStartAt) / 1000) : 0;
    debugLog('FOLD', 'BROKEN', 'Hold ended early', { reason, atSec, ...extra });
    this.maybeEmitWarning('hold-broken', true, now);
    this.callbacks.onHoldBroken?.();
    this.finish();
  }

  private emitFrameMetrics(isHoldBroken: boolean): void {
    const metrics: ForwardFoldFrameMetrics = {
      foldAngleDeg: this.smoothedFoldDeg,
      kneeFlexionDeg: this.smoothedKneeDeg,
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
    debugLog('FOLD', 'WARN', type);
    this.callbacks.onPostureWarning?.(type);
  }

  // ----------------------------------------------------------
  // Fix N: position-lost detection
  // ----------------------------------------------------------

  /** Core set = the camera-side shoulder + hip + knee + ankle (same landmarks
   *  processHoldFrame needs). */
  private hasCoreLandmarks(landmarks: PoseLandmarks): boolean {
    // Use whichever side will be tracked: the calibrated side if known,
    // otherwise accept either side being visible.
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
    debugLog('FOLD', 'WARN', 'position-lost', { lostMs: Math.round(lostMs) });
    this.callbacks.onPostureWarning?.('position-lost');
  }
}
