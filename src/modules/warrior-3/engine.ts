/**
 * WarriorThreeEngine — hold-based static-hold tracker for Warrior III
 * (Virabhadrasana III), the airplane "T". Body SIDE-ON to the camera: stand on
 * one leg, extend the other straight back, torso + back leg horizontal, standing
 * leg straight and vertical, arms reaching forward (not validated).
 *
 * The defining T is only readable from the side, where the signals are LARGE and
 * clear: torso pitch from horizontal, back-leg angle from horizontal, standing-
 * knee flex. Mirrors Warrior II's side-on hold lifecycle (cal → continuous
 * angle tracking → 1 Hz tick → shoulder-rise terminal) with these per-frame
 * metrics (all normalized/compared in degrees, no distance dependence):
 *   - torsoPitchDeg (target ~0° level; warn when too upright)
 *   - backLegAngleDeg (target ~0° level; warn when the leg drops)
 *   - standingKneeFlexDeg (target ~0° straight; warn when bent)
 *   - shoulderRise (terminal when the user stands fully back up)
 *
 * Fix list applied: B/E/F/G/H/J/N/Q/S/U/V/W/X analog (torso-length floor).
 */
import type { PoseLandmarks } from '@/modules/pose/types';
import type { WarningType } from '@/store/workout';
import { LM, lmVisible, midpoint, kneeFlexionDeg, angleFromHorizontalDeg } from './geometry';
import { WarriorThreeCalibration } from './calibration';
import type { WarriorThreeBaseline, WarriorThreeEngineCallbacks, WarriorThreeFrameMetrics } from './types';
import { debugLog } from '@/lib/debug';

// Fix W — aggressive EMA smoothing for hold-based MediaPipe noise.
const SMOOTHING_ALPHA = 0.20;
const FORM_SMOOTH_ALPHA = 0.15;

// Torso must stay hinged toward horizontal. Warn when too upright (>). Cal
// accepts < 45° → 5° hysteresis below the runtime warn.
const TORSO_LEVEL_MAX_DEG = 50;
// Back leg must stay lifted toward horizontal. Warn when it drops below this.
const BACK_LEG_LOW_MAX_DEG = 50;
// Standing leg should stay straight.
const STANDING_KNEE_MAX_DEG = 30;
// Terminal: user fully stood back up (shoulders rose from T height to standing).
// 2026-05-31 physical test: bumped 0.15 → 0.18 — the side-on shoulder-mid is
// noisy and a wobble was crossing 0.15 (wall-sit ended at 0.154 from a wobble).
const HOLD_BROKEN_SHOULDER_RISE = 0.18;
// Terminal must hold this many consecutive frames (~0.4 s) before ending — a
// brief wobble freezes (recoverable), only a real stand-up terminates.
const TERMINAL_DEBOUNCE_FRAMES = 12;

// Fix V — paired entry/exit debounce in frames.
const WARN_FRAMES = 6;
const RESUME_FRAMES = 6;

const WARNING_REPEAT_COOLDOWN_MS = 2500;
const TICK_INTERVAL_MS = 1000;

// Fix N — position-lost detection.
const POSITION_LOST_TIMEOUT_MS = 3000;
const POSITION_LOST_REPEAT_MS = 10_000;

// Idle / not-moving prompt while the user is out of the pose.
const NOT_MOVING_TIMEOUT_MS = 5000;
const NOT_MOVING_REPEAT_MS = 15_000;

// Fix U — longest-streak debounce.
const MIN_STREAK_BREAK_MS = 1000;

export class WarriorThreeEngine {
  private callbacks: WarriorThreeEngineCallbacks;
  private calibration: WarriorThreeCalibration;
  private baseline: WarriorThreeBaseline | null = null;

  // EMA-smoothed per-frame metrics.
  private smoothedTorsoPitch = 0;
  private smoothedBackLegAngle = 0;
  private smoothedStandingKneeFlex = 0;
  private smoothedFormScore = 100;
  private smoothInitialized = false;

  // Fix V — paired hysteresis pairs for each warning.
  private torsoBadFrames = 0;
  private torsoGoodFrames = 0;
  private torsoWarnActive = false;
  private backLegBadFrames = 0;
  private backLegGoodFrames = 0;
  private backLegWarnActive = false;
  private kneeBadFrames = 0;
  private kneeGoodFrames = 0;
  private kneeWarnActive = false;

  private warningCooldowns: Partial<Record<WarningType, number>> = {};

  private holdStartAt: number | null = null;
  private lastTickAt = 0;
  private finished = false;
  private broken = false;
  // Terminal debounce — consecutive frames the shoulder-rise terminal has held.
  private terminalFrames = 0;

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

  // Idle/not-moving prompt while out of pose.
  private formBrokenSince: number | null = null;
  private lastNotMovingWarnAt = 0;

  constructor(callbacks: WarriorThreeEngineCallbacks = {}) {
    this.callbacks = callbacks;
    this.calibration = new WarriorThreeCalibration();
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
        debugLog('WARRIOR3', 'HOLD', 'Hold started', {
          liftedSide: this.baseline?.liftedSide,
          initialTorsoPitch: this.baseline ? +this.baseline.initialTorsoPitchDeg.toFixed(1) : null,
          torsoLen: this.baseline ? +this.baseline.torsoLen.toFixed(3) : null,
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

    if (!lmVisible(ls) || !lmVisible(rs) || !lmVisible(lh) || !lmVisible(rh)
      || !lmVisible(lk) || !lmVisible(rk) || !lmVisible(la) || !lmVisible(ra)) return;

    const shoulderMid = midpoint(ls, rs);
    const hipMid = midpoint(lh, rh);

    // Terminal: user fully stood back up (shoulders rose from T height).
    // Debounced (Fix — 2026-05-31 physical test): a brief wobble that momentarily
    // raises the shoulders must NOT end the hold; require the rise to hold for
    // TERMINAL_DEBOUNCE_FRAMES. While it's high-but-unconfirmed, the frame is
    // frozen (no accumulation), so the user can settle back down and continue.
    const shoulderRise = baseline.shoulderY - shoulderMid.y;
    this.terminalFrames = shoulderRise > HOLD_BROKEN_SHOULDER_RISE ? this.terminalFrames + 1 : 0;
    if (this.terminalFrames >= TERMINAL_DEBOUNCE_FRAMES) {
      if (!this.broken) {
        this.broken = true;
        const atSec = this.holdStartAt ? Math.floor((now - this.holdStartAt) / 1000) : 0;
        debugLog('WARRIOR3', 'BROKEN', 'Hold ended early', {
          atSec,
          shoulderRise: +shoulderRise.toFixed(3),
        });
        this.maybeEmitWarning('hold-broken', true, now);
        this.callbacks.onHoldBroken?.();
        this.finish();
      }
      return;
    }
    if (this.terminalFrames > 0) {
      // Shoulders are up but not yet a confirmed stand-up — treat as frozen.
      this.lastFrameAt = now;
      return;
    }

    const liftedAnkle = baseline.liftedSide === 'left' ? la : ra;
    const standingAnkle = baseline.liftedSide === 'left' ? ra : la;
    const standingKnee = baseline.liftedSide === 'left' ? rk : lk;
    const standingHip = baseline.liftedSide === 'left' ? rh : lh;

    const rawTorsoPitch = angleFromHorizontalDeg(hipMid, shoulderMid);
    const rawBackLegAngle = angleFromHorizontalDeg(hipMid, liftedAnkle);
    const rawStandingKneeFlex = kneeFlexionDeg(standingHip, standingKnee, standingAnkle);

    // EMA smoothing — first frame seeds from raw.
    if (!this.smoothInitialized) {
      this.smoothedTorsoPitch = rawTorsoPitch;
      this.smoothedBackLegAngle = rawBackLegAngle;
      this.smoothedStandingKneeFlex = rawStandingKneeFlex;
      this.smoothInitialized = true;
    } else {
      this.smoothedTorsoPitch = SMOOTHING_ALPHA * rawTorsoPitch + (1 - SMOOTHING_ALPHA) * this.smoothedTorsoPitch;
      this.smoothedBackLegAngle = SMOOTHING_ALPHA * rawBackLegAngle + (1 - SMOOTHING_ALPHA) * this.smoothedBackLegAngle;
      this.smoothedStandingKneeFlex = SMOOTHING_ALPHA * rawStandingKneeFlex + (1 - SMOOTHING_ALPHA) * this.smoothedStandingKneeFlex;
    }

    // Per-frame bad flags.
    const torsoBad = this.smoothedTorsoPitch > TORSO_LEVEL_MAX_DEG;
    const backLegBad = this.smoothedBackLegAngle > BACK_LEG_LOW_MAX_DEG;
    const kneeBad = this.smoothedStandingKneeFlex > STANDING_KNEE_MAX_DEG;

    // Fix V — paired entry/exit hysteresis.
    this.torsoBadFrames = torsoBad ? this.torsoBadFrames + 1 : 0;
    this.torsoGoodFrames = torsoBad ? 0 : this.torsoGoodFrames + 1;
    if (!this.torsoWarnActive && this.torsoBadFrames >= WARN_FRAMES) this.torsoWarnActive = true;
    else if (this.torsoWarnActive && this.torsoGoodFrames >= RESUME_FRAMES) this.torsoWarnActive = false;

    this.backLegBadFrames = backLegBad ? this.backLegBadFrames + 1 : 0;
    this.backLegGoodFrames = backLegBad ? 0 : this.backLegGoodFrames + 1;
    if (!this.backLegWarnActive && this.backLegBadFrames >= WARN_FRAMES) this.backLegWarnActive = true;
    else if (this.backLegWarnActive && this.backLegGoodFrames >= RESUME_FRAMES) this.backLegWarnActive = false;

    this.kneeBadFrames = kneeBad ? this.kneeBadFrames + 1 : 0;
    this.kneeGoodFrames = kneeBad ? 0 : this.kneeGoodFrames + 1;
    if (!this.kneeWarnActive && this.kneeBadFrames >= WARN_FRAMES) this.kneeWarnActive = true;
    else if (this.kneeWarnActive && this.kneeGoodFrames >= RESUME_FRAMES) this.kneeWarnActive = false;

    const torsoWarn = this.torsoWarnActive;
    const backLegWarn = this.backLegWarnActive;
    const kneeWarn = this.kneeWarnActive;

    this.maybeEmitWarning('torso-not-level', torsoWarn, now);
    this.maybeEmitWarning('back-leg-low', backLegWarn, now);
    this.maybeEmitWarning('leg-not-straight', kneeWarn, now);

    // Form score: penalise per active warning.
    const torsoPenalty = torsoWarn ? Math.min(35, (this.smoothedTorsoPitch - TORSO_LEVEL_MAX_DEG) * 1.5) : 0;
    const backLegPenalty = backLegWarn ? Math.min(35, (this.smoothedBackLegAngle - BACK_LEG_LOW_MAX_DEG) * 1.5) : 0;
    const kneePenalty = kneeWarn ? Math.min(30, (this.smoothedStandingKneeFlex - STANDING_KNEE_MAX_DEG) * 1.5) : 0;
    const rawFormScore = Math.max(0, 100 - torsoPenalty - backLegPenalty - kneePenalty);
    this.smoothedFormScore = (1 - FORM_SMOOTH_ALPHA) * this.smoothedFormScore + FORM_SMOOTH_ALPHA * rawFormScore;

    // Fix B — accumulate only frames where form is currently OK. All three
    // warnings are structural (Fix S — recoverable but freeze the timer).
    const formBroken = torsoWarn || backLegWarn || kneeWarn;
    const dtMs = this.lastFrameAt !== null ? now - this.lastFrameAt : 0;
    if (!formBroken && dtMs > 0 && dtMs < 200) this.accumulatedValidMs += dtMs;
    this.lastFrameAt = now;

    // Fix E — TIMER frozen/resumed debug logs on freeze edges.
    if (formBroken && !this.wasFormBroken) {
      const reason = torsoWarn ? 'torso-not-level' : backLegWarn ? 'back-leg-low' : 'leg-not-straight';
      debugLog('WARRIOR3', 'TIMER', 'frozen', {
        reason,
        accumulatedSec: +(this.accumulatedValidMs / 1000).toFixed(1),
      });
    } else if (!formBroken && this.wasFormBroken) {
      debugLog('WARRIOR3', 'TIMER', 'resumed', {
        accumulatedSec: +(this.accumulatedValidMs / 1000).toFixed(1),
      });
    }
    this.wasFormBroken = formBroken;

    // Idle nudge while user is out of pose (≥ 5 s broken → fire, repeat every 15 s).
    if (formBroken) {
      if (this.formBrokenSince === null) this.formBrokenSince = now;
      const brokenFor = now - this.formBrokenSince;
      const sinceLast = this.lastNotMovingWarnAt > 0 ? now - this.lastNotMovingWarnAt : Infinity;
      if (brokenFor >= NOT_MOVING_TIMEOUT_MS && sinceLast >= NOT_MOVING_REPEAT_MS) {
        this.callbacks.onPostureWarning?.('not-moving');
        this.lastNotMovingWarnAt = now;
        debugLog('WARRIOR3', 'WARN', 'not-moving', { brokenForMs: brokenFor });
      }
    } else {
      this.formBrokenSince = null;
    }

    // Fix U — longest-streak accounting.
    if (!formBroken) {
      if (this.streakBreakCommitted) this.streakBreakCommitted = false;
      this.streakBreakStartedAt = 0;
      if (dtMs > 0 && dtMs < 200) this.currentStreakValidMs += dtMs;
    } else {
      if (this.streakBreakStartedAt === 0 && !this.streakBreakCommitted) this.streakBreakStartedAt = now;
      if (!this.streakBreakCommitted && this.streakBreakStartedAt > 0
        && now - this.streakBreakStartedAt >= MIN_STREAK_BREAK_MS) {
        if (this.currentStreakValidMs > this.longestUnfrozenStreakMs) {
          this.longestUnfrozenStreakMs = this.currentStreakValidMs;
        }
        this.currentStreakValidMs = 0;
        this.streakBreakCommitted = true;
      }
    }

    const metrics: WarriorThreeFrameMetrics = {
      torsoPitchDeg: this.smoothedTorsoPitch,
      backLegAngleDeg: this.smoothedBackLegAngle,
      standingKneeFlexDeg: this.smoothedStandingKneeFlex,
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
      debugLog('WARRIOR3', 'TICK', `Tick ${secondsElapsed}s`, {
        mqs,
        torso: +this.smoothedTorsoPitch.toFixed(1),
        backLeg: +this.smoothedBackLegAngle.toFixed(1),
        knee: +this.smoothedStandingKneeFlex.toFixed(1),
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
    debugLog('WARRIOR3', 'WARN', type);
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
    debugLog('WARRIOR3', 'WARN', 'position-lost', { lostMs: Math.round(lostMs) });
    this.callbacks.onPostureWarning?.('position-lost');
  }
}
