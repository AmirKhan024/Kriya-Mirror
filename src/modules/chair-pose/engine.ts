/**
 * ChairPoseEngine — hold-based static-hold tracker for Chair Pose (Utkatasana).
 *
 * Side-on camera. User holds a partial squat (~80–100° knee flexion) with
 * arms forward / overhead. Mirrors PlankEngine's hold lifecycle (cal →
 * continuous tracking → 1Hz tick → hold-broken on stand-up) and layers in
 * tandem-stand/single-leg-stand's hardening from rounds 9–13:
 *
 *   Fix B  — accumulator freezes during sustained bad form
 *   Fix E  — TIMER frozen/resumed debug logs on freeze edges
 *   Fix N  — position-lost detection (no usable frame for ≥ 3 s post-cal)
 *   Fix S  — recoverable form-break: knee-too-straight / torso-too-forward /
 *            heel-lift FREEZE the timer; only shoulder-rise terminates
 *   Fix U  — longest-streak with 1 s debounce (sub-1 s blips absorbed)
 *   Fix V  — paired entry/exit hysteresis on every form warning (6 frames each)
 *   Fix W  — EMA α = 0.20 (aggressive smoothing for hold-based MediaPipe noise)
 *
 * Fix R / Z / Y / T are NOT applicable: no ballistic motion (R), no balance
 * sway threshold (Z), no lifted-leg gate (Y), no subtle coaching cue (T —
 * all chair-pose warnings are structural and freeze the timer per Fix S).
 */
import type { PoseLandmarks } from '@/modules/pose/types';
import type { WarningType } from '@/store/workout';
import { LM, lmVisible, kneeFlexionDeg, trunkLeanDeg } from '@/modules/squat/geometry';
import { ChairPoseCalibration } from './calibration';
import type { ChairPoseBaseline, ChairPoseEngineCallbacks, ChairPoseFrameMetrics } from './types';
import { debugLog } from '@/lib/debug';

// Fix W — aggressive EMA smoothing for hold-based MediaPipe noise (0.20 not 0.30).
const SMOOTHING_ALPHA = 0.20;
const FORM_SMOOTH_ALPHA = 0.15;

// Squat geometry: kneeFlexionDeg returns 0 (straight) to ~150 (deep squat).
// "Too straight" = knees coming up out of the chair pose (target hold is
// 70–110° flexion). Threshold deliberately conservative — at 50° flexion the
// user has clearly partially extended.
const KNEE_TOO_STRAIGHT_DEG = 50;
// 2026-05-25 round 16: above this knee-flex angle = user has sunk past chair
// pose into a full squat (hips near floor). Recoverable per Fix S — freeze
// the timer, fire warning, user rises back to chair-pose depth → resumes.
// Initial value; tune per physical test.
const KNEE_TOO_DEEP_DEG = 120;
const TRUNK_LEAN_MAX_DEG = 30;          // beyond = leaning too far forward
const HEEL_LIFT_THRESHOLD = 0.03;       // heel rose this much vs baseline → warn
// Terminal: user fully stood back up. Conservative (0.12) so partial recovery
// from a deep sink doesn't accidentally end the workout. The fully-standing
// signal is shoulder.y rising by ≥ this fraction of the frame.
const HOLD_BROKEN_SHOULDER_RISE = 0.12;

// Fix V — paired entry/exit debounce in frames (≈ 6 frames at 30 fps = 200 ms).
const WARN_FRAMES = 6;
const RESUME_FRAMES = 6;

const WARNING_REPEAT_COOLDOWN_MS = 2500;
const TICK_INTERVAL_MS = 1000;

// Fix N — position-lost detection
const POSITION_LOST_TIMEOUT_MS = 3000;
const POSITION_LOST_REPEAT_MS = 10_000;

// 2026-05-28 round 20 — idle/not-moving prompt while user is out of pose.
// Fires when form has been broken for ≥ 5 s. Repeats every 15 s.
const NOT_MOVING_TIMEOUT_MS = 5000;
const NOT_MOVING_REPEAT_MS = 15_000;

// Fix U — longest-streak debounce. Sub-1 s freeze blips are absorbed.
const MIN_STREAK_BREAK_MS = 1000;

export class ChairPoseEngine {
  private callbacks: ChairPoseEngineCallbacks;
  private calibration: ChairPoseCalibration;
  private baseline: ChairPoseBaseline | null = null;

  // EMA-smoothed per-frame metrics. Initialized lazily on first valid frame.
  private smoothedKneeFlexDeg = 0;
  private smoothedTrunkLeanDeg = 0;
  private smoothedHeelLift = 0;
  private smoothedFormScore = 100;
  private smoothInitialized = false;

  // Fix V — paired bad/good counters + sticky warn flags. Stops single-frame
  // MediaPipe jitter from chattering each warning + the timer freeze.
  private kneeStraightBadFrames = 0;
  private kneeStraightGoodFrames = 0;
  private kneeStraightWarnActive = false;
  // 2026-05-25 round 16: inverted counterpart of kneeStraight — fires when
  // user sinks past chair pose into a full squat.
  private kneeDeepBadFrames = 0;
  private kneeDeepGoodFrames = 0;
  private kneeDeepWarnActive = false;
  private trunkLeanBadFrames = 0;
  private trunkLeanGoodFrames = 0;
  private trunkLeanWarnActive = false;
  private heelLiftBadFrames = 0;
  private heelLiftGoodFrames = 0;
  private heelLiftWarnActive = false;

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

  // Round 20 — idle/not-moving prompt while out of pose.
  private formBrokenSince: number | null = null;
  private lastNotMovingWarnAt = 0;

  constructor(callbacks: ChairPoseEngineCallbacks = {}) {
    this.callbacks = callbacks;
    this.calibration = new ChairPoseCalibration();
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
        debugLog('CHAIR', 'HOLD', 'Hold started', {
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

    // Terminal: user fully stood back up. Shoulder Y dropped (= rose in frame)
    // by ≥ HOLD_BROKEN_SHOULDER_RISE vs baseline.
    const shoulderRise = baseline.shoulderY - shoulder.y;
    if (shoulderRise > HOLD_BROKEN_SHOULDER_RISE) {
      if (!this.broken) {
        this.broken = true;
        const atSec = this.holdStartAt ? Math.floor((now - this.holdStartAt) / 1000) : 0;
        debugLog('CHAIR', 'BROKEN', 'Hold ended early', {
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
    // Trunk lean uses shoulder + hip points directly (side-on, so the single
    // landmark stands in for the midpoint).
    const rawTrunkLean = trunkLeanDeg({ x: shoulder.x, y: shoulder.y }, { x: hip.x, y: hip.y });
    const rawHeelLift = Math.max(0, baseline.ankleY - ankle.y);

    // EMA smoothing (B10 init pattern: first frame seeds from raw, then EMA).
    if (!this.smoothInitialized) {
      this.smoothedKneeFlexDeg = rawKneeFlex;
      this.smoothedTrunkLeanDeg = rawTrunkLean;
      this.smoothedHeelLift = rawHeelLift;
      this.smoothInitialized = true;
    } else {
      this.smoothedKneeFlexDeg = SMOOTHING_ALPHA * rawKneeFlex + (1 - SMOOTHING_ALPHA) * this.smoothedKneeFlexDeg;
      this.smoothedTrunkLeanDeg = SMOOTHING_ALPHA * rawTrunkLean + (1 - SMOOTHING_ALPHA) * this.smoothedTrunkLeanDeg;
      this.smoothedHeelLift = SMOOTHING_ALPHA * rawHeelLift + (1 - SMOOTHING_ALPHA) * this.smoothedHeelLift;
    }

    // Per-frame bad flags
    const kneeStraightBad = this.smoothedKneeFlexDeg < KNEE_TOO_STRAIGHT_DEG;
    const kneeDeepBad = this.smoothedKneeFlexDeg > KNEE_TOO_DEEP_DEG;
    const trunkLeanBad = this.smoothedTrunkLeanDeg > TRUNK_LEAN_MAX_DEG;
    const heelLiftBad = this.smoothedHeelLift > HEEL_LIFT_THRESHOLD;

    // Fix V — paired entry/exit hysteresis with sticky warn flags.
    this.kneeStraightBadFrames = kneeStraightBad ? this.kneeStraightBadFrames + 1 : 0;
    this.kneeStraightGoodFrames = kneeStraightBad ? 0 : this.kneeStraightGoodFrames + 1;
    if (!this.kneeStraightWarnActive && this.kneeStraightBadFrames >= WARN_FRAMES) {
      this.kneeStraightWarnActive = true;
    } else if (this.kneeStraightWarnActive && this.kneeStraightGoodFrames >= RESUME_FRAMES) {
      this.kneeStraightWarnActive = false;
    }

    this.kneeDeepBadFrames = kneeDeepBad ? this.kneeDeepBadFrames + 1 : 0;
    this.kneeDeepGoodFrames = kneeDeepBad ? 0 : this.kneeDeepGoodFrames + 1;
    if (!this.kneeDeepWarnActive && this.kneeDeepBadFrames >= WARN_FRAMES) {
      this.kneeDeepWarnActive = true;
    } else if (this.kneeDeepWarnActive && this.kneeDeepGoodFrames >= RESUME_FRAMES) {
      this.kneeDeepWarnActive = false;
    }

    this.trunkLeanBadFrames = trunkLeanBad ? this.trunkLeanBadFrames + 1 : 0;
    this.trunkLeanGoodFrames = trunkLeanBad ? 0 : this.trunkLeanGoodFrames + 1;
    if (!this.trunkLeanWarnActive && this.trunkLeanBadFrames >= WARN_FRAMES) {
      this.trunkLeanWarnActive = true;
    } else if (this.trunkLeanWarnActive && this.trunkLeanGoodFrames >= RESUME_FRAMES) {
      this.trunkLeanWarnActive = false;
    }

    this.heelLiftBadFrames = heelLiftBad ? this.heelLiftBadFrames + 1 : 0;
    this.heelLiftGoodFrames = heelLiftBad ? 0 : this.heelLiftGoodFrames + 1;
    if (!this.heelLiftWarnActive && this.heelLiftBadFrames >= WARN_FRAMES) {
      this.heelLiftWarnActive = true;
    } else if (this.heelLiftWarnActive && this.heelLiftGoodFrames >= RESUME_FRAMES) {
      this.heelLiftWarnActive = false;
    }

    const kneeStraightWarn = this.kneeStraightWarnActive;
    const kneeDeepWarn = this.kneeDeepWarnActive;
    const trunkLeanWarn = this.trunkLeanWarnActive;
    const heelLiftWarn = this.heelLiftWarnActive;

    this.maybeEmitWarning('knee-too-straight', kneeStraightWarn, now);
    this.maybeEmitWarning('knee-too-deep', kneeDeepWarn, now);
    this.maybeEmitWarning('torso-too-forward', trunkLeanWarn, now);
    this.maybeEmitWarning('heel-lift', heelLiftWarn, now);

    // Form score: penalise per active warning.
    const kneeStraightPenalty = kneeStraightWarn
      ? Math.min(40, (KNEE_TOO_STRAIGHT_DEG - this.smoothedKneeFlexDeg) * 1.5)
      : 0;
    const kneeDeepPenalty = kneeDeepWarn
      ? Math.min(30, (this.smoothedKneeFlexDeg - KNEE_TOO_DEEP_DEG) * 1.5)
      : 0;
    const trunkLeanPenalty = trunkLeanWarn
      ? Math.min(40, (this.smoothedTrunkLeanDeg - TRUNK_LEAN_MAX_DEG) * 2)
      : 0;
    const heelLiftPenalty = heelLiftWarn
      ? Math.min(20, (this.smoothedHeelLift - HEEL_LIFT_THRESHOLD) * 400)
      : 0;
    const rawFormScore = Math.max(
      0,
      100 - kneeStraightPenalty - kneeDeepPenalty - trunkLeanPenalty - heelLiftPenalty,
    );
    this.smoothedFormScore = (1 - FORM_SMOOTH_ALPHA) * this.smoothedFormScore + FORM_SMOOTH_ALPHA * rawFormScore;

    // Fix B — accumulate ONLY when form is currently OK. All four warnings
    // are structural (Fix S — recoverable but freeze the timer).
    const formBroken = kneeStraightWarn || kneeDeepWarn || trunkLeanWarn || heelLiftWarn;
    const dtMs = this.lastFrameAt !== null ? now - this.lastFrameAt : 0;
    if (!formBroken && dtMs > 0 && dtMs < 200) {
      this.accumulatedValidMs += dtMs;
    }
    this.lastFrameAt = now;

    // Fix E — TIMER frozen/resumed debug logs on freeze edges.
    if (formBroken && !this.wasFormBroken) {
      const reason = kneeStraightWarn ? 'knee-too-straight'
        : kneeDeepWarn ? 'knee-too-deep'
          : trunkLeanWarn ? 'torso-too-forward'
            : 'heel-lift';
      debugLog('CHAIR', 'TIMER', 'frozen', {
        reason,
        accumulatedSec: +(this.accumulatedValidMs / 1000).toFixed(1),
      });
    } else if (!formBroken && this.wasFormBroken) {
      debugLog('CHAIR', 'TIMER', 'resumed', {
        accumulatedSec: +(this.accumulatedValidMs / 1000).toFixed(1),
      });
    }
    this.wasFormBroken = formBroken;

    // Round 20 — idle nudge while user is out of pose.
    if (formBroken) {
      if (this.formBrokenSince === null) this.formBrokenSince = now;
      const brokenFor = now - this.formBrokenSince;
      const sinceLast = this.lastNotMovingWarnAt > 0
        ? now - this.lastNotMovingWarnAt
        : Infinity;
      if (brokenFor >= NOT_MOVING_TIMEOUT_MS && sinceLast >= NOT_MOVING_REPEAT_MS) {
        this.callbacks.onPostureWarning?.('not-moving');
        this.lastNotMovingWarnAt = now;
        debugLog('CHAIR', 'WARN', 'not-moving', { brokenForMs: brokenFor });
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

    const metrics: ChairPoseFrameMetrics = {
      kneeFlexionDeg: this.smoothedKneeFlexDeg,
      trunkLeanDeg: this.smoothedTrunkLeanDeg,
      heelLiftAmount: this.smoothedHeelLift,
      shoulderRise,
      formScore: this.smoothedFormScore,
      isHoldBroken: false,
    };
    this.callbacks.onFrame?.(metrics);

    // 1 Hz tick — secondsElapsed = VALID hold time (frozen during sustained
    // bad form); longestUnfrozenSec for the report.
    if (now - this.lastTickAt >= TICK_INTERVAL_MS) {
      this.lastTickAt = now;
      const secondsElapsed = Math.floor(this.accumulatedValidMs / 1000);
      const mqs = Math.round(this.smoothedFormScore);
      const longestUnfrozenSec = Math.max(
        Math.floor(this.longestUnfrozenStreakMs / 1000),
        Math.floor(this.currentStreakValidMs / 1000),
      );
      debugLog('CHAIR', 'TICK', `Tick ${secondsElapsed}s`, {
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
    debugLog('CHAIR', 'WARN', type);
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
    debugLog('CHAIR', 'WARN', 'position-lost', { lostMs: Math.round(lostMs) });
    this.callbacks.onPostureWarning?.('position-lost');
  }
}
