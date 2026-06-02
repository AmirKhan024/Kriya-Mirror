/**
 * BoatPoseEngine — hold-based tracker for Boat Pose (Navasana), the seated "V".
 *
 * Body SIDE-ON to the camera (the V is a sagittal-plane shape). The user sits,
 * leans the torso back and lifts the legs, balancing on the sit bones. The two
 * LARGE, clear signals are how far the torso and the legs are lifted from
 * horizontal:
 *   - torsoAngleDeg — chest lifted / leaning back; warn when it collapses
 *   - legAngleDeg   — legs lifted into the V; warn when they sag toward the floor
 *
 * Built on the warrior-3 hold structure (instant cal, EMA, 6-frame entry/exit
 * hysteresis, freeze/streak, idle, position-lost, 1 Hz tick + longestUnfrozenSec).
 * The terminal is a FULL-V-collapse (both torso AND legs flat = the user lay /
 * sat out of the boat); a single dropped segment is recoverable (freeze).
 * Segments use MIDPOINTS of the L/R landmarks.
 *
 * Fix list applied: B/E/F/G/H/J/N/Q/S/U/V/W/X analog (torso-length floor).
 */
import type { PoseLandmarks } from '@/modules/pose/types';
import type { WarningType } from '@/store/workout';
import { LM, lmVisible, midpoint, angleFromHorizontalDeg } from './geometry';
import { BoatPoseCalibration } from './calibration';
import type { BoatPoseBaseline, BoatPoseEngineCallbacks, BoatPoseFrameMetrics } from './types';
import { debugLog } from '@/lib/debug';

// Fix W — aggressive EMA smoothing for hold-based MediaPipe noise.
const EMA_ALPHA = 0.20;
const FORM_SMOOTH_ALPHA = 0.15;

// Recoverable form thresholds (warn when the segment drops below). Cal accepts
// torso ≥ 30° / legs ≥ 25° → a few degrees of hysteresis below the runtime warn.
const CHEST_DROPPED_MIN_DEG = 28;
const LEGS_DROPPED_MIN_DEG = 22;
// Terminal: the WHOLE V collapses (user lay / sat out of the boat).
const TERMINAL_TORSO_DEG = 15;
const TERMINAL_LEG_DEG = 12;
// Terminal must hold this many consecutive frames (~0.4 s) — a brief dip into a
// flat shape freezes (recoverable), only a sustained full collapse terminates.
const COLLAPSE_FRAMES = 12;

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

export class BoatPoseEngine {
  private callbacks: BoatPoseEngineCallbacks;
  private calibration: BoatPoseCalibration;
  private baseline: BoatPoseBaseline | null = null;

  private smoothedTorsoAngle = 0;
  private smoothedLegAngle = 0;
  private smoothedFormScore = 100;
  private smoothInitialized = false;

  // Fix V — paired hysteresis pairs for each warning.
  private chestBadFrames = 0;
  private chestGoodFrames = 0;
  private chestWarnActive = false;
  private legsBadFrames = 0;
  private legsGoodFrames = 0;
  private legsWarnActive = false;

  // Terminal collapse debounce.
  private collapseFrames = 0;

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

  constructor(callbacks: BoatPoseEngineCallbacks = {}) {
    this.callbacks = callbacks;
    this.calibration = new BoatPoseCalibration();
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
        debugLog('BOAT', 'HOLD', 'Hold started', {
          initialTorso: this.baseline ? +this.baseline.initialTorsoAngleDeg.toFixed(1) : null,
          initialLeg: this.baseline ? +this.baseline.initialLegAngleDeg.toFixed(1) : null,
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
    const ls = landmarks[LM.LEFT_SHOULDER];
    const rs = landmarks[LM.RIGHT_SHOULDER];
    const lh = landmarks[LM.LEFT_HIP];
    const rh = landmarks[LM.RIGHT_HIP];
    const la = landmarks[LM.LEFT_ANKLE];
    const ra = landmarks[LM.RIGHT_ANKLE];

    if (!lmVisible(ls) || !lmVisible(rs) || !lmVisible(lh) || !lmVisible(rh)
      || !lmVisible(la) || !lmVisible(ra)) return;

    const shoulderMid = midpoint(ls, rs);
    const hipMid = midpoint(lh, rh);
    const ankleMid = midpoint(la, ra);

    const rawTorsoAngle = angleFromHorizontalDeg(hipMid, shoulderMid);
    const rawLegAngle = angleFromHorizontalDeg(hipMid, ankleMid);

    if (!this.smoothInitialized) {
      this.smoothedTorsoAngle = rawTorsoAngle;
      this.smoothedLegAngle = rawLegAngle;
      this.smoothInitialized = true;
    } else {
      this.smoothedTorsoAngle = EMA_ALPHA * rawTorsoAngle + (1 - EMA_ALPHA) * this.smoothedTorsoAngle;
      this.smoothedLegAngle = EMA_ALPHA * rawLegAngle + (1 - EMA_ALPHA) * this.smoothedLegAngle;
    }

    // Terminal: the whole V has collapsed (both torso AND legs flat).
    const collapsed = this.smoothedTorsoAngle < TERMINAL_TORSO_DEG && this.smoothedLegAngle < TERMINAL_LEG_DEG;
    this.collapseFrames = collapsed ? this.collapseFrames + 1 : 0;
    if (this.collapseFrames >= COLLAPSE_FRAMES) {
      if (!this.broken) {
        this.broken = true;
        const atSec = this.holdStartAt ? Math.floor((now - this.holdStartAt) / 1000) : 0;
        debugLog('BOAT', 'BROKEN', 'Hold ended early', {
          atSec,
          torso: +this.smoothedTorsoAngle.toFixed(1),
          leg: +this.smoothedLegAngle.toFixed(1),
        });
        this.maybeEmitWarning('hold-broken', true, now);
        this.callbacks.onHoldBroken?.();
        this.finish();
      }
      return;
    }

    // Per-frame bad flags.
    const chestBad = this.smoothedTorsoAngle < CHEST_DROPPED_MIN_DEG;
    const legsBad = this.smoothedLegAngle < LEGS_DROPPED_MIN_DEG;

    // Fix V — paired entry/exit hysteresis.
    this.chestBadFrames = chestBad ? this.chestBadFrames + 1 : 0;
    this.chestGoodFrames = chestBad ? 0 : this.chestGoodFrames + 1;
    if (!this.chestWarnActive && this.chestBadFrames >= WARN_FRAMES) this.chestWarnActive = true;
    else if (this.chestWarnActive && this.chestGoodFrames >= RESUME_FRAMES) this.chestWarnActive = false;

    this.legsBadFrames = legsBad ? this.legsBadFrames + 1 : 0;
    this.legsGoodFrames = legsBad ? 0 : this.legsGoodFrames + 1;
    if (!this.legsWarnActive && this.legsBadFrames >= WARN_FRAMES) this.legsWarnActive = true;
    else if (this.legsWarnActive && this.legsGoodFrames >= RESUME_FRAMES) this.legsWarnActive = false;

    const chestWarn = this.chestWarnActive;
    const legsWarn = this.legsWarnActive;

    this.maybeEmitWarning('chest-dropped', chestWarn, now);
    this.maybeEmitWarning('legs-dropped', legsWarn, now);

    // Form score: penalise per active warning.
    const chestPenalty = chestWarn ? Math.min(35, (CHEST_DROPPED_MIN_DEG - this.smoothedTorsoAngle) * 1.5) : 0;
    const legsPenalty = legsWarn ? Math.min(35, (LEGS_DROPPED_MIN_DEG - this.smoothedLegAngle) * 1.5) : 0;
    const rawFormScore = Math.max(0, 100 - chestPenalty - legsPenalty);
    this.smoothedFormScore = (1 - FORM_SMOOTH_ALPHA) * this.smoothedFormScore + FORM_SMOOTH_ALPHA * rawFormScore;

    // Fix B — accumulate only frames where form is currently OK. Both warnings
    // are structural (Fix S — recoverable but freeze the timer).
    const formBroken = chestWarn || legsWarn;
    const dtMs = this.lastFrameAt !== null ? now - this.lastFrameAt : 0;
    if (!formBroken && dtMs > 0 && dtMs < 200) this.accumulatedValidMs += dtMs;
    this.lastFrameAt = now;

    // Fix E — TIMER frozen/resumed debug logs on freeze edges.
    if (formBroken && !this.wasFormBroken) {
      const reason = legsWarn ? 'legs-dropped' : 'chest-dropped';
      debugLog('BOAT', 'TIMER', 'frozen', {
        reason,
        accumulatedSec: +(this.accumulatedValidMs / 1000).toFixed(1),
      });
    } else if (!formBroken && this.wasFormBroken) {
      debugLog('BOAT', 'TIMER', 'resumed', {
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
        debugLog('BOAT', 'WARN', 'not-moving', { brokenForMs: brokenFor });
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

    const metrics: BoatPoseFrameMetrics = {
      torsoAngleDeg: this.smoothedTorsoAngle,
      legAngleDeg: this.smoothedLegAngle,
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
      debugLog('BOAT', 'TICK', `Tick ${secondsElapsed}s`, {
        mqs,
        torso: +this.smoothedTorsoAngle.toFixed(1),
        leg: +this.smoothedLegAngle.toFixed(1),
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
    debugLog('BOAT', 'WARN', type);
    this.callbacks.onPostureWarning?.(type);
  }

  // ----------------------------------------------------------
  // Fix N — position-lost detection
  // ----------------------------------------------------------
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
    debugLog('BOAT', 'WARN', 'position-lost', { lostMs: Math.round(lostMs) });
    this.callbacks.onPostureWarning?.('position-lost');
  }
}
