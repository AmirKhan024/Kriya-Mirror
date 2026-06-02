/**
 * WarriorOneEngine — hold-based static-hold tracker for Warrior I (Virabhadrasana I).
 *
 * Body SIDE-ON to the camera: a long front-back lunge held in the image plane,
 * front knee bent ~90°, back leg straight, trunk upright, and BOTH arms reaching
 * straight overhead. Front leg auto-detected at calibration (the leg with more
 * knee flex).
 *
 * Identical lunge mechanics to Warrior II (front/back knee + trunk + shoulder-
 * rise terminal), PLUS an arms-overhead requirement — the Warrior I signature.
 * From a side camera the overhead reach is a clean vertical wrist-above-shoulder
 * signal (unlike Warrior II's lateral arms, which point along the Z-axis and so
 * stay unvalidated there).
 *
 * Per-frame metrics:
 *   - frontKneeFlexDeg (target 50–120°, warn outside)
 *   - backKneeFlexDeg (target < 25°)
 *   - trunkLeanDeg (target < 25° from vertical)
 *   - arms overhead (both wrists above both shoulders)
 *   - shoulderRise (terminal at > 0.15)
 *
 * Fix list applied: B/E/F/G/H/J/N/Q/S/U/V/W/X analog (body-height floor).
 */
import type { PoseLandmarks } from '@/modules/pose/types';
import type { WarningType } from '@/store/workout';
import { LM, lmVisible, kneeFlexionDeg, trunkLeanDeg, midpoint } from './geometry';
import { WarriorOneCalibration } from './calibration';
import type { WarriorOneBaseline, WarriorOneEngineCallbacks, WarriorOneFrameMetrics } from './types';
import { debugLog } from '@/lib/debug';

// Fix W — aggressive EMA smoothing for hold-based MediaPipe noise.
const SMOOTHING_ALPHA = 0.20;
const FORM_SMOOTH_ALPHA = 0.15;

// Front-knee target range (mirrors Warrior II). Warn outside this band.
const FRONT_KNEE_MIN_DEG = 50;
const FRONT_KNEE_MAX_DEG = 120;
// Back knee should stay below this (straight leg).
const BACK_KNEE_MAX_DEG = 25;
// Trunk lean from vertical — beyond this = leaning too far forward.
const TRUNK_LEAN_MAX_DEG = 25;
// Arms-overhead runtime gate: both wrists must stay above both shoulders by this
// margin. Matches the calibration margin; the 6-frame debounce provides the
// hysteresis. Mirrors mountain-pose.
const ARMS_OVERHEAD_Y_MARGIN = 0.05;
// Terminal: user fully stood back up.
const HOLD_BROKEN_SHOULDER_RISE = 0.15;

// Fix V — paired entry/exit debounce in frames.
const WARN_FRAMES = 6;
const RESUME_FRAMES = 6;

const WARNING_REPEAT_COOLDOWN_MS = 2500;
const TICK_INTERVAL_MS = 1000;

// Fix N — position-lost detection.
const POSITION_LOST_TIMEOUT_MS = 3000;
const POSITION_LOST_REPEAT_MS = 10_000;

// Idle / not-moving prompt while the user is out of pose.
const NOT_MOVING_TIMEOUT_MS = 5000;
const NOT_MOVING_REPEAT_MS = 15_000;

// Fix U — longest-streak debounce.
const MIN_STREAK_BREAK_MS = 1000;

export class WarriorOneEngine {
  private callbacks: WarriorOneEngineCallbacks;
  private calibration: WarriorOneCalibration;
  private baseline: WarriorOneBaseline | null = null;

  // EMA-smoothed per-frame metrics.
  private smoothedFrontKneeFlex = 0;
  private smoothedBackKneeFlex = 0;
  private smoothedTrunkLean = 0;
  private smoothedFormScore = 100;
  private smoothInitialized = false;

  // Fix V — paired hysteresis pairs for each warning.
  private frontKneeShallowBadFrames = 0;
  private frontKneeShallowGoodFrames = 0;
  private frontKneeShallowWarnActive = false;
  private frontKneeDeepBadFrames = 0;
  private frontKneeDeepGoodFrames = 0;
  private frontKneeDeepWarnActive = false;
  private backKneeBadFrames = 0;
  private backKneeGoodFrames = 0;
  private backKneeWarnActive = false;
  private trunkLeanBadFrames = 0;
  private trunkLeanGoodFrames = 0;
  private trunkLeanWarnActive = false;
  private armsDroppedBadFrames = 0;
  private armsDroppedGoodFrames = 0;
  private armsDroppedWarnActive = false;

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

  // Idle/not-moving prompt while out of pose.
  private formBrokenSince: number | null = null;
  private lastNotMovingWarnAt = 0;

  constructor(callbacks: WarriorOneEngineCallbacks = {}) {
    this.callbacks = callbacks;
    this.calibration = new WarriorOneCalibration();
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
        debugLog('WARRIOR1', 'HOLD', 'Hold started', {
          frontLeg: this.baseline?.frontLeg,
          initialFrontKnee: this.baseline ? +this.baseline.initialFrontKneeFlexDeg.toFixed(1) : null,
          bodyHeight: this.baseline ? +this.baseline.bodyHeight.toFixed(3) : null,
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
    const lw = landmarks[LM.LEFT_WRIST];
    const rw = landmarks[LM.RIGHT_WRIST];

    if (!lmVisible(ls) || !lmVisible(rs) || !lmVisible(lh) || !lmVisible(rh)
      || !lmVisible(lk) || !lmVisible(rk) || !lmVisible(la) || !lmVisible(ra)) return;
    // Wrists also required for the arms-overhead runtime check.
    if (!lmVisible(lw) || !lmVisible(rw)) return;

    // Terminal: user fully stood back up.
    const shoulderY = (ls.y + rs.y) / 2;
    const shoulderRise = baseline.shoulderY - shoulderY;
    if (shoulderRise > HOLD_BROKEN_SHOULDER_RISE) {
      if (!this.broken) {
        this.broken = true;
        const atSec = this.holdStartAt ? Math.floor((now - this.holdStartAt) / 1000) : 0;
        debugLog('WARRIOR1', 'BROKEN', 'Hold ended early', {
          atSec,
          shoulderRise: +shoulderRise.toFixed(3),
        });
        this.maybeEmitWarning('hold-broken', true, now);
        this.callbacks.onHoldBroken?.();
        this.finish();
      }
      return;
    }

    // Per-frame knee flex per leg (front + back) per the cal-time auto-detection.
    const leftFlex = kneeFlexionDeg(lh, lk, la);
    const rightFlex = kneeFlexionDeg(rh, rk, ra);
    const rawFrontKneeFlex = baseline.frontLeg === 'left' ? leftFlex : rightFlex;
    const rawBackKneeFlex = baseline.frontLeg === 'left' ? rightFlex : leftFlex;
    // Trunk lean
    const shoulderMid = midpoint(ls, rs);
    const hipMid = midpoint(lh, rh);
    const rawTrunkLean = trunkLeanDeg(shoulderMid, hipMid);

    // EMA smoothing — first frame seeds from raw.
    if (!this.smoothInitialized) {
      this.smoothedFrontKneeFlex = rawFrontKneeFlex;
      this.smoothedBackKneeFlex = rawBackKneeFlex;
      this.smoothedTrunkLean = rawTrunkLean;
      this.smoothInitialized = true;
    } else {
      this.smoothedFrontKneeFlex = SMOOTHING_ALPHA * rawFrontKneeFlex + (1 - SMOOTHING_ALPHA) * this.smoothedFrontKneeFlex;
      this.smoothedBackKneeFlex = SMOOTHING_ALPHA * rawBackKneeFlex + (1 - SMOOTHING_ALPHA) * this.smoothedBackKneeFlex;
      this.smoothedTrunkLean = SMOOTHING_ALPHA * rawTrunkLean + (1 - SMOOTHING_ALPHA) * this.smoothedTrunkLean;
    }

    // Arms overhead: both wrists clearly above both shoulders (raw — a vertical
    // displacement check that doesn't need EMA).
    const armsOverhead = lw.y < ls.y - ARMS_OVERHEAD_Y_MARGIN
                      && rw.y < rs.y - ARMS_OVERHEAD_Y_MARGIN;

    // Per-frame bad flags
    const frontKneeShallowBad = this.smoothedFrontKneeFlex < FRONT_KNEE_MIN_DEG;
    const frontKneeDeepBad = this.smoothedFrontKneeFlex > FRONT_KNEE_MAX_DEG;
    const backKneeBad = this.smoothedBackKneeFlex > BACK_KNEE_MAX_DEG;
    const trunkLeanBad = this.smoothedTrunkLean > TRUNK_LEAN_MAX_DEG;
    const armsDroppedBad = !armsOverhead;

    // Fix V — paired entry/exit hysteresis.
    this.frontKneeShallowBadFrames = frontKneeShallowBad ? this.frontKneeShallowBadFrames + 1 : 0;
    this.frontKneeShallowGoodFrames = frontKneeShallowBad ? 0 : this.frontKneeShallowGoodFrames + 1;
    if (!this.frontKneeShallowWarnActive && this.frontKneeShallowBadFrames >= WARN_FRAMES) {
      this.frontKneeShallowWarnActive = true;
    } else if (this.frontKneeShallowWarnActive && this.frontKneeShallowGoodFrames >= RESUME_FRAMES) {
      this.frontKneeShallowWarnActive = false;
    }

    this.frontKneeDeepBadFrames = frontKneeDeepBad ? this.frontKneeDeepBadFrames + 1 : 0;
    this.frontKneeDeepGoodFrames = frontKneeDeepBad ? 0 : this.frontKneeDeepGoodFrames + 1;
    if (!this.frontKneeDeepWarnActive && this.frontKneeDeepBadFrames >= WARN_FRAMES) {
      this.frontKneeDeepWarnActive = true;
    } else if (this.frontKneeDeepWarnActive && this.frontKneeDeepGoodFrames >= RESUME_FRAMES) {
      this.frontKneeDeepWarnActive = false;
    }

    this.backKneeBadFrames = backKneeBad ? this.backKneeBadFrames + 1 : 0;
    this.backKneeGoodFrames = backKneeBad ? 0 : this.backKneeGoodFrames + 1;
    if (!this.backKneeWarnActive && this.backKneeBadFrames >= WARN_FRAMES) {
      this.backKneeWarnActive = true;
    } else if (this.backKneeWarnActive && this.backKneeGoodFrames >= RESUME_FRAMES) {
      this.backKneeWarnActive = false;
    }

    this.trunkLeanBadFrames = trunkLeanBad ? this.trunkLeanBadFrames + 1 : 0;
    this.trunkLeanGoodFrames = trunkLeanBad ? 0 : this.trunkLeanGoodFrames + 1;
    if (!this.trunkLeanWarnActive && this.trunkLeanBadFrames >= WARN_FRAMES) {
      this.trunkLeanWarnActive = true;
    } else if (this.trunkLeanWarnActive && this.trunkLeanGoodFrames >= RESUME_FRAMES) {
      this.trunkLeanWarnActive = false;
    }

    this.armsDroppedBadFrames = armsDroppedBad ? this.armsDroppedBadFrames + 1 : 0;
    this.armsDroppedGoodFrames = armsDroppedBad ? 0 : this.armsDroppedGoodFrames + 1;
    if (!this.armsDroppedWarnActive && this.armsDroppedBadFrames >= WARN_FRAMES) {
      this.armsDroppedWarnActive = true;
    } else if (this.armsDroppedWarnActive && this.armsDroppedGoodFrames >= RESUME_FRAMES) {
      this.armsDroppedWarnActive = false;
    }

    const frontKneeShallowWarn = this.frontKneeShallowWarnActive;
    const frontKneeDeepWarn = this.frontKneeDeepWarnActive;
    const backKneeWarn = this.backKneeWarnActive;
    const trunkLeanWarn = this.trunkLeanWarnActive;
    const armsDroppedWarn = this.armsDroppedWarnActive;

    this.maybeEmitWarning('front-knee-not-bent-enough', frontKneeShallowWarn, now);
    this.maybeEmitWarning('front-knee-bent-too-much', frontKneeDeepWarn, now);
    this.maybeEmitWarning('back-knee-bent', backKneeWarn, now);
    this.maybeEmitWarning('torso-too-forward', trunkLeanWarn, now);
    this.maybeEmitWarning('arms-not-overhead', armsDroppedWarn, now);

    // Form score: penalise per active warning.
    const shallowPenalty = frontKneeShallowWarn
      ? Math.min(35, (FRONT_KNEE_MIN_DEG - this.smoothedFrontKneeFlex) * 1.5)
      : 0;
    const deepPenalty = frontKneeDeepWarn
      ? Math.min(30, (this.smoothedFrontKneeFlex - FRONT_KNEE_MAX_DEG) * 1.5)
      : 0;
    const backKneePenalty = backKneeWarn
      ? Math.min(30, (this.smoothedBackKneeFlex - BACK_KNEE_MAX_DEG) * 1.5)
      : 0;
    const trunkLeanPenalty = trunkLeanWarn
      ? Math.min(30, (this.smoothedTrunkLean - TRUNK_LEAN_MAX_DEG) * 2)
      : 0;
    const armsPenalty = armsDroppedWarn ? 30 : 0;
    const rawFormScore = Math.max(
      0,
      100 - shallowPenalty - deepPenalty - backKneePenalty - trunkLeanPenalty - armsPenalty,
    );
    this.smoothedFormScore = (1 - FORM_SMOOTH_ALPHA) * this.smoothedFormScore + FORM_SMOOTH_ALPHA * rawFormScore;

    // Fix B — accumulate only frames where form is currently OK. All five
    // warnings are structural (Fix S — recoverable but freeze the timer).
    const formBroken = frontKneeShallowWarn || frontKneeDeepWarn || backKneeWarn
      || trunkLeanWarn || armsDroppedWarn;
    const dtMs = this.lastFrameAt !== null ? now - this.lastFrameAt : 0;
    if (!formBroken && dtMs > 0 && dtMs < 200) {
      this.accumulatedValidMs += dtMs;
    }
    this.lastFrameAt = now;

    // Fix E — TIMER frozen/resumed debug logs on freeze edges.
    if (formBroken && !this.wasFormBroken) {
      const reason = armsDroppedWarn ? 'arms-not-overhead'
        : frontKneeShallowWarn ? 'front-knee-not-bent-enough'
          : frontKneeDeepWarn ? 'front-knee-bent-too-much'
            : backKneeWarn ? 'back-knee-bent'
              : 'torso-too-forward';
      debugLog('WARRIOR1', 'TIMER', 'frozen', {
        reason,
        accumulatedSec: +(this.accumulatedValidMs / 1000).toFixed(1),
      });
    } else if (!formBroken && this.wasFormBroken) {
      debugLog('WARRIOR1', 'TIMER', 'resumed', {
        accumulatedSec: +(this.accumulatedValidMs / 1000).toFixed(1),
      });
    }
    this.wasFormBroken = formBroken;

    // Idle nudge while user is out of pose (≥ 5 s broken → fire, repeat every 15 s).
    if (formBroken) {
      if (this.formBrokenSince === null) this.formBrokenSince = now;
      const brokenFor = now - this.formBrokenSince;
      const sinceLast = this.lastNotMovingWarnAt > 0
        ? now - this.lastNotMovingWarnAt
        : Infinity;
      if (brokenFor >= NOT_MOVING_TIMEOUT_MS && sinceLast >= NOT_MOVING_REPEAT_MS) {
        this.callbacks.onPostureWarning?.('not-moving');
        this.lastNotMovingWarnAt = now;
        debugLog('WARRIOR1', 'WARN', 'not-moving', { brokenForMs: brokenFor });
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

    const metrics: WarriorOneFrameMetrics = {
      frontKneeFlexDeg: this.smoothedFrontKneeFlex,
      backKneeFlexDeg: this.smoothedBackKneeFlex,
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
      debugLog('WARRIOR1', 'TICK', `Tick ${secondsElapsed}s`, {
        mqs,
        frontKnee: +this.smoothedFrontKneeFlex.toFixed(1),
        backKnee: +this.smoothedBackKneeFlex.toFixed(1),
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
    debugLog('WARRIOR1', 'WARN', type);
    this.callbacks.onPostureWarning?.(type);
  }

  // ----------------------------------------------------------
  // Fix N — position-lost detection
  // ----------------------------------------------------------
  private hasCoreLandmarks(landmarks: PoseLandmarks): boolean {
    // Warrior I needs BOTH legs visible (front-knee + back-knee tracking).
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
    debugLog('WARRIOR1', 'WARN', 'position-lost', { lostMs: Math.round(lostMs) });
    this.callbacks.onPostureWarning?.('position-lost');
  }
}
