/**
 * StarPoseEngine — hold-based single-leg balance tracker (Star Pose / star
 * balance). Mirrors Single Leg Stand's hold lifecycle + sway-score
 * infrastructure verbatim (CoM proxy, EMA α=0.20, baseline from the first 30
 * valid frames of the HOLD, shoulder-width normalization, paired entry/exit
 * hysteresis, longest-streak debounce, position-lost heartbeat).
 *
 * Star Pose = stand on one leg, extend the OTHER leg out to the side, raise
 * BOTH arms into a star. Differences vs Single Leg Stand:
 *   - `liftedSide` is the EXTENDED leg (auto-detected at calibration: the
 *     higher, laterally-spread ankle).
 *   - `foot-dropped` (recoverable freeze): the extended leg lowered back down
 *     OR retracted in from the wide star stance — the user left the single-leg
 *     star. They can re-extend and continue.
 *   - `arms-dropped` (coaching cue, NOT a freeze — Fix T): both arms fell below
 *     the shoulders. Fires once with a long cooldown; never freezes the timer
 *     (mirrors BB10, where star arm/leg form is guidance only).
 *   - runtime too-far / too-close distance nudges during the hold.
 * Only `shoulder-rise` (user fully stood up) terminates the hold.
 */
import type { NormalizedLandmark, PoseLandmarks } from '@/modules/pose/types';
import type { WarningType } from '@/store/workout';
import { LM, lmVisible, comProxy } from './geometry';
import { StarPoseCalibration } from './calibration';
import type { StarPoseBaseline, StarPoseEngineCallbacks, StarPoseFrameMetrics } from './types';
import { getSwayPenalty } from './scoring';
import { debugLog } from '@/lib/debug';

const SMOOTHING_ALPHA = 0.20;          // aggressive CoM smoothing (suppresses MediaPipe jitter)
const HOLD_BASELINE_FRAMES = 30;       // ~1 s of settled frames for a non-biased reference

// Single-leg balance produces 3–5 cm of normal CoM sway → 4–7° on the
// atan2(displacement/shoulderWidth) formula. Real-world single-leg holds wobble
// more than the lab estimate (physical test: 12° froze correct holds) → 16°.
const SWAY_WARN_ANGLE_DEG = 16;
const SWAY_WARN_FRAMES = 6;
const SWAY_RESUME_FRAMES = 6;

// Extended leg left the star (recoverable freeze). Floors sit comfortably below
// the calibration thresholds (LEG_LIFT_RATIO 0.12, LEG_LATERAL_RATIO 1.30) so
// hysteresis prevents chatter at the boundary. Either signal collapsing means
// the leg dropped or retracted.
const FOOT_DROPPED_LIFT_FLOOR = 0.03;   // (standingAnkleY - liftedAnkleY)/shoulderWidth below this → leg lowered
const FOOT_DROPPED_WIDE_FLOOR = 0.80;   // ankleXSep/shoulderWidth below this → leg retracted in
const FOOT_DROPPED_DEBOUNCE_FRAMES = 8;
const FOOT_DROPPED_RESUME_FRAMES = 8;

// Arms dropped — coaching cue only (Fix T). Fires once, then suppressed for a
// long cooldown. Never freezes the timer.
const ARMS_DOWN_DEBOUNCE_FRAMES = 8;
const ARMS_DROPPED_COOLDOWN_MS = 12_000;

// Terminal "stood up" margin + debounce: only end on a SUSTAINED rise so a
// momentary wobble (physical test: ended the hold instantly) never terminates.
const HOLD_BROKEN_SHOULDER_RISE = 0.18;
const SHOULDER_RISE_DEBOUNCE_FRAMES = 18;   // ~0.6 s sustained

// Form-break grace + forgiving escalation. The first breaks just freeze the
// timer (recoverable); the hold only ENDS after a long continuous freeze OR
// many separate breaks — then the existing hold-broken path speaks before the
// report. A short grace at hold start absorbs the settle-in transient.
const HOLD_START_GRACE_MS = 1500;
const FORM_BREAK_END_CONTINUOUS_MS = 7000;
const FORM_BREAK_END_COUNT = 5;

const FORM_SMOOTH_ALPHA = 0.15;
const TICK_INTERVAL_MS = 1000;
// Slower re-fire so a lingering condition doesn't machine-gun the same nudge
// (physical test: 2.5 s felt constant). Anti-spam, not a behavior change.
const WARNING_REPEAT_COOLDOWN_MS = 6000;

const POSITION_LOST_TIMEOUT_MS = 3000;
const POSITION_LOST_REPEAT_MS = 10_000;

const MIN_STREAK_BREAK_MS = 1000;
// Sway is normalized by refShoulderWidth; a FAR user has a tiny shoulderWidth
// (physical test: 0.084) which over-amplifies sway and froze correct holds.
// Clamp the denominator to a higher floor so distance doesn't inflate the angle
// (near users, already ≥ floor, are unaffected by the max()).
const MIN_SHOULDER_WIDTH_RUNTIME = 0.12;

// Runtime distance nudge (owner request: tell the user mid-hold if they drift
// too far / too close). Looser than calibration to avoid false positives;
// sustained for ~1 s before firing, then a long cooldown.
const RUNTIME_BODY_HEIGHT_MIN = 0.32;
const RUNTIME_BODY_HEIGHT_MAX = 1.05;
const RUNTIME_MIN_SHOULDER_WIDTH = 0.06;
const RUNTIME_DISTANCE_DEBOUNCE_FRAMES = 45;
const RUNTIME_DISTANCE_COOLDOWN_MS = 12_000;

export class StarPoseEngine {
  private callbacks: StarPoseEngineCallbacks;
  private calibration: StarPoseCalibration;
  private baseline: StarPoseBaseline | null = null;

  private smoothedComX = 0;
  private smoothedComY = 0;
  private smoothedComInitialized = false;

  private holdBaselineComX: number | null = null;
  private holdBaselineComY: number | null = null;
  private holdBaselineFrames: Array<{ x: number; y: number }> = [];

  private smoothedFormScore = 100;

  // Warn-state hysteresis (paired bad/good counters + sticky flag).
  private swayBadFrames = 0;
  private swayGoodFrames = 0;
  private swayWarnActive = false;
  private footDroppedBadFrames = 0;
  private footDroppedGoodFrames = 0;
  private footDroppedWarnActive = false;
  private armsDownFrames = 0;

  private warningCooldowns: Partial<Record<WarningType, number>> = {};
  private lastArmsDroppedWarnAt = 0;

  // Runtime distance monitoring
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

  // Freeze the hold counter during sustained `swaying` OR `foot-dropped`.
  private accumulatedValidMs = 0;
  private lastFrameAt: number | null = null;
  private wasFormBroken = false;

  // Longest continuous unfrozen-form streak (ms), 1 s debounce.
  private longestUnfrozenStreakMs = 0;
  private currentStreakValidMs = 0;
  private streakBreakStartedAt = 0;
  private streakBreakCommitted = false;

  // position-lost detection (tracking-validity heartbeat)
  private lastValidFrameAt = 0;
  private lastPositionLostWarnAt = 0;

  constructor(callbacks: StarPoseEngineCallbacks = {}) {
    this.callbacks = callbacks;
    this.calibration = new StarPoseCalibration();
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
        debugLog('STAR', 'HOLD', 'Hold started', {
          liftedSide: this.baseline?.liftedSide,
          shoulderWidth: this.baseline ? +this.baseline.shoulderWidth.toFixed(3) : null,
          ankleXSep: this.baseline ? +this.baseline.ankleXSep.toFixed(3) : null,
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
    const la = landmarks[LM.LEFT_ANKLE];
    const ra = landmarks[LM.RIGHT_ANKLE];
    const lw = landmarks[LM.LEFT_WRIST];
    const rw = landmarks[LM.RIGHT_WRIST];

    const coreOk = lmVisible(ls) && lmVisible(rs) && lmVisible(lh) && lmVisible(rh)
      && lmVisible(la) && lmVisible(ra);
    if (!coreOk) return;

    const refShoulderWidth = Math.max(baseline.shoulderWidth, MIN_SHOULDER_WIDTH_RUNTIME);

    // Hold broken: user stood up (shoulder rose vs cal). Terminal, but only on a
    // SUSTAINED rise (debounced) so a wobble doesn't end the hold.
    const shoulderY = (ls.y + rs.y) / 2;
    const shoulderRise = baseline.shoulderY - shoulderY;
    this.shoulderRiseFrames = shoulderRise > HOLD_BROKEN_SHOULDER_RISE ? this.shoulderRiseFrames + 1 : 0;
    if (this.shoulderRiseFrames >= SHOULDER_RISE_DEBOUNCE_FRAMES) {
      this.fireHoldBroken('shoulder-rise', now, { shoulderRise });
      return;
    }

    // Runtime distance nudge (sustained, debounced). Does not affect the score.
    this.checkRuntimeDistance(ls, rs, la, ra, now);

    // Extended leg left the star (recoverable freeze): lowered OR retracted.
    const liftedAnkle = baseline.liftedSide === 'left' ? la : ra;
    const standingAnkle = baseline.liftedSide === 'left' ? ra : la;
    const ankleYDelta = standingAnkle.y - liftedAnkle.y;      // positive when extended leg is above standing
    const ankleXSep = Math.abs(la.x - ra.x);
    const footDroppedBad =
      (ankleYDelta / refShoulderWidth < FOOT_DROPPED_LIFT_FLOOR)
      || (ankleXSep / refShoulderWidth < FOOT_DROPPED_WIDE_FLOOR);

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

    // Hold baseline from the first 30 valid frames (settled star position).
    if (this.holdBaselineComX === null) {
      this.holdBaselineFrames.push({ x: this.smoothedComX, y: this.smoothedComY });
      if (this.holdBaselineFrames.length >= HOLD_BASELINE_FRAMES) {
        const meanX = this.holdBaselineFrames.reduce((s, p) => s + p.x, 0) / this.holdBaselineFrames.length;
        const meanY = this.holdBaselineFrames.reduce((s, p) => s + p.y, 0) / this.holdBaselineFrames.length;
        this.holdBaselineComX = meanX;
        this.holdBaselineComY = meanY;
        debugLog('STAR', 'HOLD', 'Hold baseline captured', {
          baselineX: +meanX.toFixed(3),
          baselineY: +meanY.toFixed(3),
        });
      }
      this.emitFrameMetrics(0, 0, false);
      return;
    }

    // Sway displacement (distance-independent via shoulder-width)
    const baseComX = this.holdBaselineComX;
    const baseComY = this.holdBaselineComY!;
    const dx = this.smoothedComX - baseComX;
    const dy = this.smoothedComY - baseComY;
    const rawDisplacement = Math.hypot(dx, dy) / refShoulderWidth;
    const swayAngleDeg = Math.atan2(rawDisplacement, 1.0) * (180 / Math.PI);

    // Paired entry/exit debounce + sticky warn state (Fix V).
    const swayBad = swayAngleDeg > SWAY_WARN_ANGLE_DEG;
    this.swayBadFrames = swayBad ? this.swayBadFrames + 1 : 0;
    this.swayGoodFrames = swayBad ? 0 : this.swayGoodFrames + 1;
    if (!this.swayWarnActive && this.swayBadFrames >= SWAY_WARN_FRAMES) {
      this.swayWarnActive = true;
    } else if (this.swayWarnActive && this.swayGoodFrames >= SWAY_RESUME_FRAMES) {
      this.swayWarnActive = false;
    }

    this.footDroppedBadFrames = footDroppedBad ? this.footDroppedBadFrames + 1 : 0;
    this.footDroppedGoodFrames = footDroppedBad ? 0 : this.footDroppedGoodFrames + 1;
    if (!this.footDroppedWarnActive && this.footDroppedBadFrames >= FOOT_DROPPED_DEBOUNCE_FRAMES) {
      this.footDroppedWarnActive = true;
    } else if (this.footDroppedWarnActive && this.footDroppedGoodFrames >= FOOT_DROPPED_RESUME_FRAMES) {
      this.footDroppedWarnActive = false;
    }

    // Hold-start grace: let the user settle into the pose without an instant
    // freeze/warning. Hysteresis state still updates; we just don't act on it.
    const inGrace = now - this.holdStartAt! < HOLD_START_GRACE_MS;
    const swayWarn = this.swayWarnActive && !inGrace;
    const footDroppedWarn = this.footDroppedWarnActive && !inGrace;

    this.maybeEmitWarning('swaying', swayWarn, now);
    this.maybeEmitWarning('foot-dropped', footDroppedWarn, now);

    // Arms-dropped coaching cue (Fix T — never freezes the timer). The cold-
    // start sentinel (Fix P) lets the FIRST cue fire even when engine `now` is
    // still smaller than the cooldown window.
    const armsDown = lw.y > ls.y && rw.y > rs.y;     // both wrists below shoulders (Y inverted)
    this.armsDownFrames = armsDown ? this.armsDownFrames + 1 : 0;
    const armsCueAllowed = this.lastArmsDroppedWarnAt === 0
      || now - this.lastArmsDroppedWarnAt >= ARMS_DROPPED_COOLDOWN_MS;
    if (this.armsDownFrames >= ARMS_DOWN_DEBOUNCE_FRAMES && armsCueAllowed) {
      this.lastArmsDroppedWarnAt = now;
      debugLog('STAR', 'WARN', 'arms-dropped');
      this.callbacks.onPostureWarning?.('arms-dropped');
    }

    // Form score (smoothed) — pure balance (sway only).
    const swayPen = getSwayPenalty(swayAngleDeg);
    const rawFormScore = Math.max(0, 100 - swayPen);
    this.smoothedFormScore = (1 - FORM_SMOOTH_ALPHA) * this.smoothedFormScore + FORM_SMOOTH_ALPHA * rawFormScore;

    // Accumulate only frames where form is currently OK. `swaying` AND
    // `foot-dropped` freeze the counter; arms-dropped does NOT (coaching cue).
    const formBroken = swayWarn || footDroppedWarn;
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
      const reason = footDroppedWarn ? 'foot-dropped' : 'swaying';
      debugLog('STAR', 'TIMER', 'frozen', {
        reason,
        breakCount: this.breakCount,
        accumulatedSec: +(this.accumulatedValidMs / 1000).toFixed(1),
      });
    } else if (!formBroken && this.wasFormBroken) {
      debugLog('STAR', 'TIMER', 'resumed', {
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

    // Longest-streak accounting with 1 s debounce.
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

    this.emitFrameMetrics(swayAngleDeg, rawDisplacement, false);

    // 1Hz tick — secondsElapsed reflects VALID hold time, not wall-clock.
    if (now - this.lastTickAt >= TICK_INTERVAL_MS) {
      this.lastTickAt = now;
      const secondsElapsed = Math.floor(this.accumulatedValidMs / 1000);
      const mqs = Math.round(this.smoothedFormScore);
      const longestUnfrozenSec = Math.max(
        Math.floor(this.longestUnfrozenStreakMs / 1000),
        Math.floor(this.currentStreakValidMs / 1000),
      );
      debugLog('STAR', 'TICK', `Tick ${secondsElapsed}s`, {
        mqs,
        sway: +swayAngleDeg.toFixed(2),
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
    debugLog('STAR', 'WARN', hint, { bodyHeight: +bodyHeight.toFixed(3), shoulderWidth: +shoulderWidth.toFixed(3) });
    this.callbacks.onPostureWarning?.(hint);
  }

  private fireHoldBroken(reason: string, now: number, extra: Record<string, unknown>): void {
    if (this.broken) return;
    this.broken = true;
    const atSec = this.holdStartAt ? Math.floor((now - this.holdStartAt) / 1000) : 0;
    debugLog('STAR', 'BROKEN', 'Hold ended early', { reason, atSec, ...extra });
    this.maybeEmitWarning('hold-broken', true, now);
    this.callbacks.onHoldBroken?.();
    this.finish();
  }

  private emitFrameMetrics(
    swayAngleDeg: number,
    swayDisplacement: number,
    isHoldBroken: boolean,
  ): void {
    const metrics: StarPoseFrameMetrics = {
      swayAngleDeg,
      swayDisplacement,
      formScore: this.smoothedFormScore,
      isHoldBroken,
    };
    this.callbacks.onFrame?.(metrics);
  }

  private maybeEmitWarning(type: WarningType, active: boolean, now: number): void {
    if (!active) return;
    // Cold-start sentinel (Fix P): always allow the FIRST fire; the cooldown
    // only throttles re-fires. (A `?? 0` default would suppress any warning
    // occurring before `now` reaches WARNING_REPEAT_COOLDOWN_MS.)
    const last = this.warningCooldowns[type];
    if (last !== undefined && now - last < WARNING_REPEAT_COOLDOWN_MS) return;
    this.warningCooldowns[type] = now;
    debugLog('STAR', 'WARN', type);
    this.callbacks.onPostureWarning?.(type);
  }

  // ----------------------------------------------------------
  // position-lost detection
  // ----------------------------------------------------------

  /** Core set = shoulders + hips + ankles (no wrists/knees required — the
   *  engine scores from CoM proxy + ankle positions). */
  private hasCoreLandmarks(landmarks: PoseLandmarks): boolean {
    return lmVisible(landmarks[LM.LEFT_SHOULDER]) && lmVisible(landmarks[LM.RIGHT_SHOULDER])
      && lmVisible(landmarks[LM.LEFT_HIP])      && lmVisible(landmarks[LM.RIGHT_HIP])
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
    debugLog('STAR', 'WARN', 'position-lost', { lostMs: Math.round(lostMs) });
    this.callbacks.onPostureWarning?.('position-lost');
  }
}
