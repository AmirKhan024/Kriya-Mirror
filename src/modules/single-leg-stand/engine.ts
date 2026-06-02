/**
 * SingleLegStandEngine — hold-based balance tracker.
 *
 * Mirrors Tandem Stand's hold lifecycle + sway-score infrastructure verbatim
 * (CoM proxy, EMA α=0.30, baseline from first 10 valid frames of the HOLD,
 * shoulder-width normalization for distance independence).
 *
 * NEW vs Tandem Stand:
 *   - `liftedSide` (auto-detected at calibration: ankle with smaller Y).
 *   - `hip-tilted` warning: lifted-side hip drops below standing-side hip
 *     by > shoulderWidth × 0.15 for 6+ frames.
 *   - Hold-broken: lifted ankle returns to within shoulderWidth × 0.10 of
 *     the standing-side ankle Y (i.e., the user put their foot down).
 */
import type { PoseLandmarks } from '@/modules/pose/types';
import type { WarningType } from '@/store/workout';
import { LM, lmVisible, comProxy } from './geometry';
import { SingleLegStandCalibration } from './calibration';
import type { SingleLegStandBaseline, SingleLegStandEngineCallbacks, SingleLegStandFrameMetrics } from './types';
import { getHipTiltPenalty } from './scoring';
import { getSwayPenalty } from '@/modules/tandem-stand/scoring';
import { debugLog } from '@/lib/debug';

// 2026-05-25 round 12: dropped 0.30 → 0.20 for more aggressive CoM smoothing.
// Suppresses MediaPipe single-frame jitter that was producing 6° sway angles
// (right at the warn threshold) on every other frame. Real postural sway
// lasting > 200ms still trips the 6-frame entry debounce.
const SMOOTHING_ALPHA = 0.20;
// 2026-05-25 round 15: 10 → 30 frames (~1 s). The shorter baseline capture
// was biased by any wobble in the first 333 ms of the hold, producing a
// non-centered reference point that amplified subsequent sway readings.
// Tandem stand stays at 10 — its wider stance produces less wobble during
// baseline capture.
const HOLD_BASELINE_FRAMES = 30;

// 2026-05-25 round 15: 6° → 12°. Single-leg standing produces 3-5 cm of
// normal CoM sway (vs ~1 cm bilateral), which at typical camera distance
// translates to 4-7° on the engine's atan2(displacement/shoulderWidth)
// formula — right at the old threshold. Result: warning fired constantly
// during physical-test on calm holds, freezing the timer indefinitely.
// 12° corresponds to ~5 cm displacement — clearly abnormal sway. Tandem
// stays at 6° because the wider stance produces less real sway.
const SWAY_WARN_ANGLE_DEG = 12;
const SWAY_WARN_FRAMES = 6;
const SWAY_RESUME_FRAMES = 6;          // round 12: 200ms of sustained "good" before clearing the warn

const HIP_TILT_RATIO = 0.15;           // hipDropAmount / shoulderWidth > this → warn
const HIP_TILT_DEBOUNCE_FRAMES = 6;
const HIP_TILT_RESUME_FRAMES = 6;

// 2026-05-25 round 11: foot-dropped is now a RECOVERABLE form warning (fires
// + freezes timer) rather than a hold-broken trigger. The user can lift their
// foot back up and continue. Only `shoulder-rise` (user fully standing up)
// still terminates the hold.
const FOOT_DROPPED_RATIO = 0.10;       // |liftedAnkle.y - standingAnkleY| < this × shoulderWidth → ankle down
// 2026-05-25 round 14: require knee to ALSO indicate "down" before declaring
// foot-dropped. Ankle alone is too noisy (matches the cal-side knee-confirmation).
const FOOT_DROPPED_KNEE_RATIO = 0.20;  // |liftedKnee.y - standingKnee.y| < this × shoulderWidth → knee down
const FOOT_DROPPED_DEBOUNCE_FRAMES = 8;
const FOOT_DROPPED_RESUME_FRAMES = 8;
const HOLD_BROKEN_SHOULDER_RISE = 0.15;

const FORM_SMOOTH_ALPHA = 0.15;
const TICK_INTERVAL_MS = 1000;
const WARNING_REPEAT_COOLDOWN_MS = 2500;

// 2026-05-25 round 6: position-lost detection — fire if no usable pose frame
// for ≥ 3 s post-cal, repeat every 10 s while still lost.
const POSITION_LOST_TIMEOUT_MS = 3000;
const POSITION_LOST_REPEAT_MS = 10_000;

// 2026-05-25 round 10: longest-hold streak debounce. A freeze blip shorter
// than this duration is absorbed into the ongoing streak rather than ending
// it. Mirrors tandem-stand's MIN_STREAK_BREAK_MS.
const MIN_STREAK_BREAK_MS = 1000;

// 2026-05-25 round 13: defensive floor on baseline.shoulderWidth at runtime.
// Calibration now rejects baselines below this value (see calibration.ts),
// but this guards against any path that might still produce a tiny value
// (third-party callers, future engines, etc.). All distance-normalized
// thresholds use max(baseline.shoulderWidth, MIN_SHOULDER_WIDTH_RUNTIME).
const MIN_SHOULDER_WIDTH_RUNTIME = 0.08;

export class SingleLegStandEngine {
  private callbacks: SingleLegStandEngineCallbacks;
  private calibration: SingleLegStandCalibration;
  private baseline: SingleLegStandBaseline | null = null;

  private smoothedComX = 0;
  private smoothedComY = 0;
  private smoothedComInitialized = false;

  private holdBaselineComX: number | null = null;
  private holdBaselineComY: number | null = null;
  private holdBaselineFrames: Array<{ x: number; y: number }> = [];

  private smoothedFormScore = 100;

  // 2026-05-25 round 12: warn-state hysteresis. Each warning has paired
  // bad/good counters and a sticky `*WarnActive` flag. Entry requires N
  // consecutive bad frames; exit requires N consecutive good frames. Without
  // this, single-frame MediaPipe jitter pumped the warn on/off, stuttering
  // the visible timer.
  private swayBadFrames = 0;
  private swayGoodFrames = 0;
  private swayWarnActive = false;
  private hipTiltBadFrames = 0;
  private hipTiltGoodFrames = 0;
  private hipTiltWarnActive = false;
  private footDroppedBadFrames = 0;
  private footDroppedGoodFrames = 0;
  private footDroppedWarnActive = false;

  private warningCooldowns: Partial<Record<WarningType, number>> = {};

  private holdStartAt: number | null = null;
  private lastTickAt = 0;
  private finished = false;
  private broken = false;

  // 2026-05-25 round 5 (HANDOFF §4.5 Fix B): freeze the hold counter during
  // sustained `swaying` OR `hip-tilted`. Mirrors plank/tandem. `foot-dropped`
  // and `shoulder-rise` remain terminal — they mean the user actively left
  // the unilateral pose.
  private accumulatedValidMs = 0;
  private lastFrameAt: number | null = null;
  private wasFormBroken = false;

  // 2026-05-25 round 10: longest continuous unfrozen-form streak (ms), with a
  // 1 s debounce so sub-second freeze blips don't end the streak. Same shape
  // as tandem-stand's round-10 fix.
  private longestUnfrozenStreakMs = 0;
  private currentStreakValidMs = 0;
  private streakBreakStartedAt = 0;
  private streakBreakCommitted = false;

  // 2026-05-25 round 6: position-lost detection (tracking-validity heartbeat)
  private lastValidFrameAt = 0;
  private lastPositionLostWarnAt = 0;

  constructor(callbacks: SingleLegStandEngineCallbacks = {}) {
    this.callbacks = callbacks;
    this.calibration = new SingleLegStandCalibration();
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
        // 2026-05-25 round 6: seed position-lost heartbeat on cal-confirm.
        this.lastValidFrameAt = now;
        debugLog('SLS', 'HOLD', 'Hold started', {
          liftedSide: this.baseline?.liftedSide,
          shoulderWidth: this.baseline ? +this.baseline.shoulderWidth.toFixed(3) : null,
        });
      }
      return;
    }

    // 2026-05-25 round 6: post-cal position-lost check runs regardless of
    // whether the current frame has usable landmarks.
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

    // Hold broken: user stood up (shoulder rose vs cal)
    const shoulderY = (ls.y + rs.y) / 2;
    const shoulderRise = baseline.shoulderY - shoulderY;
    if (shoulderRise > HOLD_BROKEN_SHOULDER_RISE) {
      this.fireHoldBroken('shoulder-rise', now, { shoulderRise });
      return;
    }

    // 2026-05-25 round 11: foot-dropped is now a RECOVERABLE form warning.
    // Detected per-frame, debounced, then emitted + added to the freeze list.
    // The user can lift their leg back up and continue the hold.
    // 2026-05-25 round 13: floor shoulderWidth so degenerate baselines can't
    // collapse the threshold to within MediaPipe noise.
    const refShoulderWidth = Math.max(baseline.shoulderWidth, MIN_SHOULDER_WIDTH_RUNTIME);
    const liftedAnkle = baseline.liftedSide === 'left' ? la : ra;
    const standingAnkle = baseline.liftedSide === 'left' ? ra : la;
    const liftedKnee = baseline.liftedSide === 'left' ? lk : rk;
    const standingKnee = baseline.liftedSide === 'left' ? rk : lk;
    const ankleYDelta = standingAnkle.y - liftedAnkle.y;   // positive when lifted is above standing
    const kneeYDelta = standingKnee.y - liftedKnee.y;
    // 2026-05-25 round 14: require BOTH ankle AND knee to indicate the leg
    // has dropped. Either signal alone is too noisy. If the knee is still
    // clearly raised, the user is still doing the exercise.
    const footDroppedBad =
      ankleYDelta < refShoulderWidth * FOOT_DROPPED_RATIO
      && kneeYDelta < refShoulderWidth * FOOT_DROPPED_KNEE_RATIO;

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

    // Hold baseline from first 10 valid frames (per Tandem Stand pattern)
    if (this.holdBaselineComX === null) {
      this.holdBaselineFrames.push({ x: this.smoothedComX, y: this.smoothedComY });
      if (this.holdBaselineFrames.length >= HOLD_BASELINE_FRAMES) {
        const meanX = this.holdBaselineFrames.reduce((s, p) => s + p.x, 0) / this.holdBaselineFrames.length;
        const meanY = this.holdBaselineFrames.reduce((s, p) => s + p.y, 0) / this.holdBaselineFrames.length;
        this.holdBaselineComX = meanX;
        this.holdBaselineComY = meanY;
        debugLog('SLS', 'HOLD', 'Hold baseline captured', {
          baselineX: +meanX.toFixed(3),
          baselineY: +meanY.toFixed(3),
        });
      }
      this.emitFrameMetrics(0, 0, 0, false);
      return;
    }

    // Sway displacement (distance-independent via shoulder-width)
    const baseComX = this.holdBaselineComX;
    const baseComY = this.holdBaselineComY!;
    const dx = this.smoothedComX - baseComX;
    const dy = this.smoothedComY - baseComY;
    const rawDisplacement = Math.hypot(dx, dy) / refShoulderWidth;
    const swayAngleDeg = Math.atan2(rawDisplacement, 1.0) * (180 / Math.PI);

    // Hip tilt: lifted-side hip should stay near standing-side hip y
    const liftedHip = baseline.liftedSide === 'left' ? lh : rh;
    const standingHip = baseline.liftedSide === 'left' ? rh : lh;
    const hipDropAmount = liftedHip.y - standingHip.y;    // positive = lifted-side dropped
    const hipTiltBad = hipDropAmount > refShoulderWidth * HIP_TILT_RATIO;

    // 2026-05-25 round 12: paired entry/exit debounce + sticky warn state.
    // Stops single-frame MediaPipe jitter from chattering the warn on/off.
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

    const swayWarn = this.swayWarnActive;
    const hipTiltWarn = this.hipTiltWarnActive;
    const footDroppedWarn = this.footDroppedWarnActive;

    this.maybeEmitWarning('swaying', swayWarn, now);
    this.maybeEmitWarning('hip-tilted', hipTiltWarn, now);
    this.maybeEmitWarning('foot-dropped', footDroppedWarn, now);

    // Form score (smoothed)
    const swayPen = getSwayPenalty(swayAngleDeg);
    const tiltPen = getHipTiltPenalty(hipDropAmount, refShoulderWidth);
    const rawFormScore = Math.max(0, 100 - swayPen - tiltPen);
    this.smoothedFormScore = (1 - FORM_SMOOTH_ALPHA) * this.smoothedFormScore + FORM_SMOOTH_ALPHA * rawFormScore;

    // 2026-05-25 round 5 (HANDOFF §4.5 Fix B + Fix E): accumulate only frames
    // where form is currently OK. `swaying`, `hip-tilted`, AND `foot-dropped`
    // (round 11) all freeze the counter. The user can recover from any of
    // these by getting back into single-leg position.
    const formBroken = swayWarn || hipTiltWarn || footDroppedWarn;
    const dtMs = this.lastFrameAt !== null ? now - this.lastFrameAt : 0;
    if (!formBroken && dtMs > 0 && dtMs < 200) {
      this.accumulatedValidMs += dtMs;
    }
    this.lastFrameAt = now;
    if (formBroken && !this.wasFormBroken) {
      const reason = footDroppedWarn ? 'foot-dropped'
        : hipTiltWarn ? 'hip-tilted'
        : 'swaying';
      debugLog('SLS', 'TIMER', 'frozen', {
        reason,
        accumulatedSec: +(this.accumulatedValidMs / 1000).toFixed(1),
      });
    } else if (!formBroken && this.wasFormBroken) {
      debugLog('SLS', 'TIMER', 'resumed', {
        accumulatedSec: +(this.accumulatedValidMs / 1000).toFixed(1),
      });
    }
    this.wasFormBroken = formBroken;

    // 2026-05-25 round 10: longest-streak accounting with 1 s debounce.
    if (!formBroken) {
      if (this.streakBreakCommitted) {
        this.streakBreakCommitted = false;
      }
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

    this.emitFrameMetrics(swayAngleDeg, rawDisplacement, hipDropAmount, false);

    // 1Hz tick — secondsElapsed reflects VALID hold time, not wall-clock.
    if (now - this.lastTickAt >= TICK_INTERVAL_MS) {
      this.lastTickAt = now;
      const secondsElapsed = Math.floor(this.accumulatedValidMs / 1000);
      const mqs = Math.round(this.smoothedFormScore);
      const longestUnfrozenSec = Math.max(
        Math.floor(this.longestUnfrozenStreakMs / 1000),
        Math.floor(this.currentStreakValidMs / 1000),
      );
      debugLog('SLS', 'TICK', `Tick ${secondsElapsed}s`, {
        mqs,
        sway: +swayAngleDeg.toFixed(2),
        hipDrop: +hipDropAmount.toFixed(3),
        longestUnfrozenSec,
      });
      this.callbacks.onHoldTick?.({ secondsElapsed, mqs, longestUnfrozenSec });
    }
  }

  private fireHoldBroken(reason: string, now: number, extra: Record<string, unknown>): void {
    if (this.broken) return;
    this.broken = true;
    const atSec = this.holdStartAt ? Math.floor((now - this.holdStartAt) / 1000) : 0;
    debugLog('SLS', 'BROKEN', 'Hold ended early', { reason, atSec, ...extra });
    this.maybeEmitWarning('hold-broken', true, now);
    this.callbacks.onHoldBroken?.();
    this.finish();
  }

  private emitFrameMetrics(
    swayAngleDeg: number,
    swayDisplacement: number,
    hipDropAmount: number,
    isHoldBroken: boolean,
  ): void {
    const metrics: SingleLegStandFrameMetrics = {
      swayAngleDeg,
      swayDisplacement,
      hipDropAmount,
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
    debugLog('SLS', 'WARN', type);
    this.callbacks.onPostureWarning?.(type);
  }

  // ----------------------------------------------------------
  // 2026-05-25 round 6: position-lost detection
  // ----------------------------------------------------------

  /** Mirrors the coreOk check inside processHoldFrame so position-lost uses
   *  the same definition of "usable frame". Core set = shoulders + hips +
   *  knees + ankles (no wrists needed for the engine). */
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
    debugLog('SLS', 'WARN', 'position-lost', { lostMs: Math.round(lostMs) });
    this.callbacks.onPostureWarning?.('position-lost');
  }
}
