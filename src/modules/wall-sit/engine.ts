/**
 * WallSitEngine — hold-based static-hold tracker for the Wall Sit.
 *
 * Side-on camera. User sits with their back flat against a wall, thighs ≈
 * parallel to the floor (~90° knee flexion), shins vertical. Mechanically a
 * chair pose braced against a wall, so this mirrors ChairPoseEngine's hold
 * lifecycle and hardening (cal → continuous tracking → 1Hz tick → hold-broken
 * on stand-up) with two differences:
 *
 *   1. No `knee-too-deep` warning — the wall + vertical shins physically stop
 *      the user from sinking below parallel, so that fault can't occur.
 *   2. `torso-too-forward` fires sooner (25° vs 30°) because the back should
 *      stay vertical against the wall, not hinge forward.
 *
 * Applied fixes (same set as chair-pose):
 *   Fix B — accumulator freezes during sustained bad form
 *   Fix E — TIMER frozen/resumed debug logs on freeze edges
 *   Fix N — position-lost detection (no usable frame for ≥ 3 s post-cal)
 *   Fix S — recoverable form-break: knee-too-straight / torso-too-forward /
 *           heel-lift FREEZE the timer; only shoulder-rise terminates
 *   Fix U — longest-streak with 1 s debounce (sub-1 s blips absorbed)
 *   Fix V — paired entry/exit hysteresis on every form warning (6 frames each)
 *   Fix W — EMA α = 0.20 (aggressive smoothing for hold-based MediaPipe noise)
 */
import type { PoseLandmarks } from '@/modules/pose/types';
import type { WarningType } from '@/store/workout';
import { LM, lmVisible, kneeFlexionDeg, trunkLeanDeg } from '@/modules/squat/geometry';
import { WallSitCalibration } from './calibration';
import type { WallSitBaseline, WallSitEngineCallbacks, WallSitFrameMetrics } from './types';
import { debugLog } from '@/lib/debug';

// Fix W — aggressive EMA smoothing for hold-based MediaPipe noise (0.20 not 0.30).
const SMOOTHING_ALPHA = 0.20;
const FORM_SMOOTH_ALPHA = 0.15;

// 2026-05-31 physical-test fix: "knee-too-straight" is now RELATIVE to the
// user's own held depth, not an absolute angle. Previously a user who confirmed
// calibration just above the floor (e.g. 58°) instantly tripped the absolute
// 60° threshold → the timer froze the entire hold. We capture a stabilized
// hold-baseline knee flex from the first ~15 valid frames, then only warn when
// the user has clearly risen out of THEIR depth.
const HOLD_BASELINE_FRAMES = 15;
const KNEE_SLIP_TOLERANCE_DEG = 22;   // flex must drop this far below the held depth to warn
// Back should stay flat/vertical on the wall. Now relative to the calibrated
// trunk lean (+ tolerance) so a slight natural lean doesn't freeze the timer.
const TRUNK_SLIP_TOLERANCE_DEG = 20;
// Terminal: user fully stood/slid back up. Conservative (0.12) so partial
// recovery doesn't accidentally end the workout.
const HOLD_BROKEN_SHOULDER_RISE = 0.12;

// Fix V — paired entry/exit debounce in frames (≈ 6 frames at 30 fps = 200 ms).
const WARN_FRAMES = 6;
const RESUME_FRAMES = 6;

const WARNING_REPEAT_COOLDOWN_MS = 2500;
const TICK_INTERVAL_MS = 1000;

// Fix N — position-lost detection.
const POSITION_LOST_TIMEOUT_MS = 3000;
const POSITION_LOST_REPEAT_MS = 10_000;

// Idle/not-moving prompt while the user is out of the wall sit. Fires when form
// has been broken for ≥ 5 s; repeats every 15 s.
const NOT_MOVING_TIMEOUT_MS = 5000;
const NOT_MOVING_REPEAT_MS = 15_000;

// Fix U — longest-streak debounce. Sub-1 s freeze blips are absorbed.
const MIN_STREAK_BREAK_MS = 1000;

export class WallSitEngine {
  private callbacks: WallSitEngineCallbacks;
  private calibration: WallSitCalibration;
  private baseline: WallSitBaseline | null = null;

  // EMA-smoothed per-frame metrics. Initialized lazily on first valid frame.
  private smoothedKneeFlexDeg = 0;
  private smoothedTrunkLeanDeg = 0;
  private smoothedFormScore = 100;
  private smoothInitialized = false;

  // Stabilized hold-baseline knee flex (avg of first HOLD_BASELINE_FRAMES). The
  // "knee-too-straight" warning is suppressed until this is captured.
  private holdBaselineKneeDeg: number | null = null;
  private holdBaselineSamples: number[] = [];

  // Fix V — paired bad/good counters + sticky warn flags.
  private kneeStraightBadFrames = 0;
  private kneeStraightGoodFrames = 0;
  private kneeStraightWarnActive = false;
  private trunkLeanBadFrames = 0;
  private trunkLeanGoodFrames = 0;
  private trunkLeanWarnActive = false;

  private warningCooldowns: Partial<Record<WarningType, number>> = {};

  private holdStartAt: number | null = null;
  private lastTickAt = 0;
  private finished = false;
  private broken = false;

  // Fix B — accumulator pauses during sustained bad form.
  private accumulatedValidMs = 0;
  private lastFrameAt: number | null = null;
  private wasFormBroken = false;

  // Fix U — longest continuous unfrozen streak (with 1 s debounce).
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

  constructor(callbacks: WallSitEngineCallbacks = {}) {
    this.callbacks = callbacks;
    this.calibration = new WallSitCalibration();
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
        // Fix N — seed heartbeat so we don't insta-fire on the first post-cal frame.
        this.lastValidFrameAt = now;
        debugLog('WALLSIT', 'HOLD', 'Hold started', {
          side: this.baseline?.side,
          initialKneeFlex: this.baseline ? +this.baseline.initialKneeFlexionDeg.toFixed(1) : null,
          bodyHeight: this.baseline ? +this.baseline.bodyHeight.toFixed(3) : null,
        });
      }
      return;
    }

    // Fix N — position-lost check BEFORE the landmark-null early return.
    const haveValidFrame = !!landmarks && this.hasCoreLandmarks(landmarks);
    this.checkPositionLost(haveValidFrame, now);

    if (!haveValidFrame || !this.baseline || !this.holdStartAt) return;
    this.processHoldFrame(landmarks!, now);
  }

  finish(): void { this.finished = true; }

  /** Hold-based engines don't have sets. */
  resetForNextSet(): void { /* noop */ }

  // ----------------------------------------------------------
  private processHoldFrame(landmarks: PoseLandmarks, now: number): void {
    const baseline = this.baseline!;
    const side = baseline.side;

    const shoulder = landmarks[side === 'left' ? LM.LEFT_SHOULDER : LM.RIGHT_SHOULDER];
    const hip = landmarks[side === 'left' ? LM.LEFT_HIP : LM.RIGHT_HIP];
    const knee = landmarks[side === 'left' ? LM.LEFT_KNEE : LM.RIGHT_KNEE];
    const ankle = landmarks[side === 'left' ? LM.LEFT_ANKLE : LM.RIGHT_ANKLE];

    if (!lmVisible(shoulder) || !lmVisible(hip) || !lmVisible(knee) || !lmVisible(ankle)) return;

    // Terminal: user fully stood back up. Shoulder Y rose (smaller y in frame)
    // by ≥ HOLD_BROKEN_SHOULDER_RISE vs baseline.
    const shoulderRise = baseline.shoulderY - shoulder.y;
    if (shoulderRise > HOLD_BROKEN_SHOULDER_RISE) {
      if (!this.broken) {
        this.broken = true;
        const atSec = this.holdStartAt ? Math.floor((now - this.holdStartAt) / 1000) : 0;
        debugLog('WALLSIT', 'BROKEN', 'Hold ended early', {
          atSec,
          shoulderRise: +shoulderRise.toFixed(3),
        });
        this.maybeEmitWarning('hold-broken', true, now);
        this.callbacks.onHoldBroken?.();
        this.finish();
      }
      return;
    }

    // Per-frame raw metrics (squat geometry: 0 = straight, ~90 = parallel).
    const rawKneeFlex = kneeFlexionDeg(hip, knee, ankle);
    const rawTrunkLean = trunkLeanDeg({ x: shoulder.x, y: shoulder.y }, { x: hip.x, y: hip.y });

    // EMA smoothing (first frame seeds from raw, then EMA).
    if (!this.smoothInitialized) {
      this.smoothedKneeFlexDeg = rawKneeFlex;
      this.smoothedTrunkLeanDeg = rawTrunkLean;
      this.smoothInitialized = true;
    } else {
      this.smoothedKneeFlexDeg = SMOOTHING_ALPHA * rawKneeFlex + (1 - SMOOTHING_ALPHA) * this.smoothedKneeFlexDeg;
      this.smoothedTrunkLeanDeg = SMOOTHING_ALPHA * rawTrunkLean + (1 - SMOOTHING_ALPHA) * this.smoothedTrunkLeanDeg;
    }

    // Capture the stabilized hold-baseline knee flex from the first frames. The
    // knee-too-straight warning is suppressed until this is set (grace), so a
    // single bad calibration frame can't freeze the timer instantly.
    if (this.holdBaselineKneeDeg === null) {
      this.holdBaselineSamples.push(this.smoothedKneeFlexDeg);
      if (this.holdBaselineSamples.length >= HOLD_BASELINE_FRAMES) {
        this.holdBaselineKneeDeg =
          this.holdBaselineSamples.reduce((s, v) => s + v, 0) / this.holdBaselineSamples.length;
        debugLog('WALLSIT', 'HOLD', 'Hold baseline captured', {
          baselineKneeFlex: +this.holdBaselineKneeDeg.toFixed(1),
        });
      }
    }

    // Per-frame bad flags — RELATIVE to the user's own held depth / lean.
    const kneeSlipFloor = this.holdBaselineKneeDeg !== null
      ? this.holdBaselineKneeDeg - KNEE_SLIP_TOLERANCE_DEG
      : null;
    const kneeStraightBad = kneeSlipFloor !== null && this.smoothedKneeFlexDeg < kneeSlipFloor;
    const trunkLeanLimit = baseline.initialTrunkLeanDeg + TRUNK_SLIP_TOLERANCE_DEG;
    const trunkLeanBad = this.smoothedTrunkLeanDeg > trunkLeanLimit;

    // Fix V — paired entry/exit hysteresis with sticky warn flags.
    this.kneeStraightBadFrames = kneeStraightBad ? this.kneeStraightBadFrames + 1 : 0;
    this.kneeStraightGoodFrames = kneeStraightBad ? 0 : this.kneeStraightGoodFrames + 1;
    if (!this.kneeStraightWarnActive && this.kneeStraightBadFrames >= WARN_FRAMES) {
      this.kneeStraightWarnActive = true;
    } else if (this.kneeStraightWarnActive && this.kneeStraightGoodFrames >= RESUME_FRAMES) {
      this.kneeStraightWarnActive = false;
    }

    this.trunkLeanBadFrames = trunkLeanBad ? this.trunkLeanBadFrames + 1 : 0;
    this.trunkLeanGoodFrames = trunkLeanBad ? 0 : this.trunkLeanGoodFrames + 1;
    if (!this.trunkLeanWarnActive && this.trunkLeanBadFrames >= WARN_FRAMES) {
      this.trunkLeanWarnActive = true;
    } else if (this.trunkLeanWarnActive && this.trunkLeanGoodFrames >= RESUME_FRAMES) {
      this.trunkLeanWarnActive = false;
    }

    const kneeStraightWarn = this.kneeStraightWarnActive;
    const trunkLeanWarn = this.trunkLeanWarnActive;

    this.maybeEmitWarning('knee-too-straight', kneeStraightWarn, now);
    this.maybeEmitWarning('torso-too-forward', trunkLeanWarn, now);

    // Form score: penalise per active warning.
    const kneeStraightPenalty = (kneeStraightWarn && kneeSlipFloor !== null)
      ? Math.min(40, (kneeSlipFloor - this.smoothedKneeFlexDeg) * 1.5)
      : 0;
    const trunkLeanPenalty = trunkLeanWarn
      ? Math.min(40, (this.smoothedTrunkLeanDeg - trunkLeanLimit) * 2)
      : 0;
    const rawFormScore = Math.max(0, 100 - kneeStraightPenalty - trunkLeanPenalty);
    this.smoothedFormScore = (1 - FORM_SMOOTH_ALPHA) * this.smoothedFormScore + FORM_SMOOTH_ALPHA * rawFormScore;

    // Fix B — accumulate ONLY when form is currently OK. Both warnings are
    // structural (Fix S — recoverable but freeze the timer). Heel-lift was
    // dropped: the side-view ankle Y is too noisy and false-fired instantly.
    const formBroken = kneeStraightWarn || trunkLeanWarn;
    const dtMs = this.lastFrameAt !== null ? now - this.lastFrameAt : 0;
    if (!formBroken && dtMs > 0 && dtMs < 200) {
      this.accumulatedValidMs += dtMs;
    }
    this.lastFrameAt = now;

    // Fix E — TIMER frozen/resumed debug logs on freeze edges.
    if (formBroken && !this.wasFormBroken) {
      const reason = kneeStraightWarn ? 'knee-too-straight' : 'torso-too-forward';
      debugLog('WALLSIT', 'TIMER', 'frozen', {
        reason,
        accumulatedSec: +(this.accumulatedValidMs / 1000).toFixed(1),
      });
    } else if (!formBroken && this.wasFormBroken) {
      debugLog('WALLSIT', 'TIMER', 'resumed', {
        accumulatedSec: +(this.accumulatedValidMs / 1000).toFixed(1),
      });
    }
    this.wasFormBroken = formBroken;

    // Idle nudge while user is out of pose.
    if (formBroken) {
      if (this.formBrokenSince === null) this.formBrokenSince = now;
      const brokenFor = now - this.formBrokenSince;
      const sinceLast = this.lastNotMovingWarnAt > 0
        ? now - this.lastNotMovingWarnAt
        : Infinity;
      if (brokenFor >= NOT_MOVING_TIMEOUT_MS && sinceLast >= NOT_MOVING_REPEAT_MS) {
        this.callbacks.onPostureWarning?.('not-moving');
        this.lastNotMovingWarnAt = now;
        debugLog('WALLSIT', 'WARN', 'not-moving', { brokenForMs: brokenFor });
      }
    } else {
      this.formBrokenSince = null;
    }

    // Fix U — longest-streak accounting. Sub-1 s freeze absorbed; only a
    // sustained ≥ MIN_STREAK_BREAK_MS continuous freeze commits the streak.
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

    const metrics: WallSitFrameMetrics = {
      kneeFlexionDeg: this.smoothedKneeFlexDeg,
      trunkLeanDeg: this.smoothedTrunkLeanDeg,
      heelLiftAmount: 0, // heel-lift detection dropped (noisy side-view ankle)
      shoulderRise,
      formScore: this.smoothedFormScore,
      isHoldBroken: false,
    };
    this.callbacks.onFrame?.(metrics);

    // 1 Hz tick — secondsElapsed = VALID hold time (frozen during sustained bad
    // form); longestUnfrozenSec for the report.
    if (now - this.lastTickAt >= TICK_INTERVAL_MS) {
      this.lastTickAt = now;
      const secondsElapsed = Math.floor(this.accumulatedValidMs / 1000);
      const mqs = Math.round(this.smoothedFormScore);
      const longestUnfrozenSec = Math.max(
        Math.floor(this.longestUnfrozenStreakMs / 1000),
        Math.floor(this.currentStreakValidMs / 1000),
      );
      debugLog('WALLSIT', 'TICK', `Tick ${secondsElapsed}s`, {
        mqs,
        kneeFlex: +this.smoothedKneeFlexDeg.toFixed(1),
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
    debugLog('WALLSIT', 'WARN', type);
    this.callbacks.onPostureWarning?.(type);
  }

  // ----------------------------------------------------------
  // Fix N — position-lost detection
  // ----------------------------------------------------------
  private hasCoreLandmarks(landmarks: PoseLandmarks): boolean {
    const ls = landmarks[LM.LEFT_SHOULDER];
    const rs = landmarks[LM.RIGHT_SHOULDER];
    const lh = landmarks[LM.LEFT_HIP];
    const rh = landmarks[LM.RIGHT_HIP];
    const lk = landmarks[LM.LEFT_KNEE];
    const rk = landmarks[LM.RIGHT_KNEE];
    const la = landmarks[LM.LEFT_ANKLE];
    const ra = landmarks[LM.RIGHT_ANKLE];
    // Either side fully visible is enough — we pick side at calibration.
    const leftOk = lmVisible(ls) && lmVisible(lh) && lmVisible(lk) && lmVisible(la);
    const rightOk = lmVisible(rs) && lmVisible(rh) && lmVisible(rk) && lmVisible(ra);
    return leftOk || rightOk;
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
    debugLog('WALLSIT', 'WARN', 'position-lost', { lostMs: Math.round(lostMs) });
    this.callbacks.onPostureWarning?.('position-lost');
  }
}
