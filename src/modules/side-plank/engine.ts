/**
 * SidePlankEngine — hold-based tracker for the Side Plank (Vasisthasana).
 *
 * CHEST faces the camera so the lateral hip-sag is in the image plane. The body
 * is a straight, elongated line across the frame; the coaching signal — like the
 * regular plank — is the hip's deviation from the shoulder→ankle line:
 *   - hip drops toward the floor → `hip-sag`
 *   - hip lifts too high → `hip-pike`
 *   - the body bends at the hip → `spine-misaligned`
 *
 * Built on the modern warrior-3 / mountain-pose hold structure (instant cal,
 * EMA, 6-frame entry/exit hysteresis, freeze/streak, idle, position-lost,
 * shoulder-rise terminal) with plank's body-line metric. The body line uses
 * MIDPOINTS of L/R shoulders/hips/ankles (both sides visible chest-on).
 *
 * Fix list applied: B/E/F/G/H/J/N/Q/S/U/V/W/X analog (body-length floor).
 */
import type { PoseLandmarks } from '@/modules/pose/types';
import type { WarningType } from '@/store/workout';
import { LM, lmVisible, midpoint } from './geometry';
import { SidePlankCalibration } from './calibration';
import type { SidePlankBaseline, SidePlankEngineCallbacks, SidePlankFrameMetrics } from './types';
import { debugLog } from '@/lib/debug';

// Fix W — aggressive EMA smoothing for hold-based MediaPipe noise.
const EMA_ALPHA = 0.20;
const FORM_SMOOTH_ALPHA = 0.15;

// Body-line thresholds (normalized image coords; mirror plank).
const HIP_SAG_THRESHOLD = 0.04;          // smoothedHipDelta > this → sagging
const HIP_PIKE_THRESHOLD = 0.04;         // smoothedHipDelta < -this → piked
const SPINE_DEVIATION_DEG = 12;          // bend at the hip
// Terminal: user sat / stood up out of the side plank.
const HOLD_BROKEN_SHOULDER_RISE = 0.18;
// Terminal must hold this many consecutive frames (~0.4 s) before ending — a
// brief wobble freezes (recoverable), only a real sit-up terminates.
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

export class SidePlankEngine {
  private callbacks: SidePlankEngineCallbacks;
  private calibration: SidePlankCalibration;
  private baseline: SidePlankBaseline | null = null;

  private smoothedHipDelta = 0;
  private smoothedSpineDeg = 0;
  private smoothedFormScore = 100;
  private smoothInitialized = false;

  // Fix V — paired hysteresis pairs for each warning.
  private sagBadFrames = 0;
  private sagGoodFrames = 0;
  private sagWarnActive = false;
  private pikeBadFrames = 0;
  private pikeGoodFrames = 0;
  private pikeWarnActive = false;
  private spineBadFrames = 0;
  private spineGoodFrames = 0;
  private spineWarnActive = false;

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

  constructor(callbacks: SidePlankEngineCallbacks = {}) {
    this.callbacks = callbacks;
    this.calibration = new SidePlankCalibration();
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
        debugLog('SIDEPLANK', 'HOLD', 'Hold started', {
          baselineHipY: this.baseline ? +this.baseline.hipY.toFixed(3) : null,
          bodyLength: this.baseline ? +this.baseline.bodyLength.toFixed(3) : null,
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
    const la = landmarks[LM.LEFT_ANKLE];
    const ra = landmarks[LM.RIGHT_ANKLE];

    if (!lmVisible(ls) || !lmVisible(rs) || !lmVisible(lh) || !lmVisible(rh)
      || !lmVisible(la) || !lmVisible(ra)) return;

    const shoulderMid = midpoint(ls, rs);
    const hipMid = midpoint(lh, rh);
    const ankleMid = midpoint(la, ra);

    // Terminal: user sat / stood up (shoulders rose vs the held side plank).
    // Debounced (Fix — 2026-05-31 physical test): a brief wobble that momentarily
    // raises the shoulders must NOT end the hold; require the rise to hold for
    // TERMINAL_DEBOUNCE_FRAMES. While high-but-unconfirmed, the frame is frozen.
    const shoulderRise = baseline.shoulderY - shoulderMid.y;
    this.terminalFrames = shoulderRise > HOLD_BROKEN_SHOULDER_RISE ? this.terminalFrames + 1 : 0;
    if (this.terminalFrames >= TERMINAL_DEBOUNCE_FRAMES) {
      if (!this.broken) {
        this.broken = true;
        const atSec = this.holdStartAt ? Math.floor((now - this.holdStartAt) / 1000) : 0;
        debugLog('SIDEPLANK', 'BROKEN', 'Hold ended early', {
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
      // Shoulders are up but not yet a confirmed sit-up — treat as frozen.
      this.lastFrameAt = now;
      return;
    }

    // Hip deviation from the calibrated level (positive = sagging below).
    const rawHipDelta = hipMid.y - baseline.hipY;
    // Spine bend at the hip (shoulder→hip vs hip→ankle).
    const v1x = hipMid.x - shoulderMid.x, v1y = hipMid.y - shoulderMid.y;
    const v2x = ankleMid.x - hipMid.x, v2y = ankleMid.y - hipMid.y;
    const dot = v1x * v2x + v1y * v2y;
    const cross = Math.abs(v1x * v2y - v1y * v2x);
    const rawSpineDeg = Math.atan2(cross, dot) * (180 / Math.PI);

    if (!this.smoothInitialized) {
      this.smoothedHipDelta = rawHipDelta;
      this.smoothedSpineDeg = rawSpineDeg;
      this.smoothInitialized = true;
    } else {
      this.smoothedHipDelta = EMA_ALPHA * rawHipDelta + (1 - EMA_ALPHA) * this.smoothedHipDelta;
      this.smoothedSpineDeg = EMA_ALPHA * rawSpineDeg + (1 - EMA_ALPHA) * this.smoothedSpineDeg;
    }

    // Per-frame bad flags.
    const sagBad = this.smoothedHipDelta > HIP_SAG_THRESHOLD;
    const pikeBad = this.smoothedHipDelta < -HIP_PIKE_THRESHOLD;
    const spineBad = this.smoothedSpineDeg > SPINE_DEVIATION_DEG;

    // Fix V — paired entry/exit hysteresis.
    this.sagBadFrames = sagBad ? this.sagBadFrames + 1 : 0;
    this.sagGoodFrames = sagBad ? 0 : this.sagGoodFrames + 1;
    if (!this.sagWarnActive && this.sagBadFrames >= WARN_FRAMES) this.sagWarnActive = true;
    else if (this.sagWarnActive && this.sagGoodFrames >= RESUME_FRAMES) this.sagWarnActive = false;

    this.pikeBadFrames = pikeBad ? this.pikeBadFrames + 1 : 0;
    this.pikeGoodFrames = pikeBad ? 0 : this.pikeGoodFrames + 1;
    if (!this.pikeWarnActive && this.pikeBadFrames >= WARN_FRAMES) this.pikeWarnActive = true;
    else if (this.pikeWarnActive && this.pikeGoodFrames >= RESUME_FRAMES) this.pikeWarnActive = false;

    this.spineBadFrames = spineBad ? this.spineBadFrames + 1 : 0;
    this.spineGoodFrames = spineBad ? 0 : this.spineGoodFrames + 1;
    if (!this.spineWarnActive && this.spineBadFrames >= WARN_FRAMES) this.spineWarnActive = true;
    else if (this.spineWarnActive && this.spineGoodFrames >= RESUME_FRAMES) this.spineWarnActive = false;

    const sagWarn = this.sagWarnActive;
    const pikeWarn = this.pikeWarnActive;
    const spineWarn = this.spineWarnActive;

    this.maybeEmitWarning('hip-sag', sagWarn, now);
    this.maybeEmitWarning('hip-pike', pikeWarn, now);
    this.maybeEmitWarning('spine-misaligned', spineWarn, now);

    // Form score: penalise per active deviation (mirror plank).
    const sagPenalty = sagWarn ? Math.min(40, this.smoothedHipDelta * 600) : 0;
    const pikePenalty = pikeWarn ? Math.min(40, -this.smoothedHipDelta * 600) : 0;
    const spinePenalty = spineWarn ? Math.min(40, (this.smoothedSpineDeg - SPINE_DEVIATION_DEG) * 2) : 0;
    const rawFormScore = Math.max(0, 100 - sagPenalty - pikePenalty - spinePenalty);
    this.smoothedFormScore = (1 - FORM_SMOOTH_ALPHA) * this.smoothedFormScore + FORM_SMOOTH_ALPHA * rawFormScore;

    // Fix B — accumulate only frames where form is currently OK. All three
    // deviations are structural (Fix S — recoverable but freeze the timer).
    const formBroken = sagWarn || pikeWarn || spineWarn;
    const dtMs = this.lastFrameAt !== null ? now - this.lastFrameAt : 0;
    if (!formBroken && dtMs > 0 && dtMs < 200) this.accumulatedValidMs += dtMs;
    this.lastFrameAt = now;

    // Fix E — TIMER frozen/resumed debug logs on freeze edges.
    if (formBroken && !this.wasFormBroken) {
      const reason = sagWarn ? 'hip-sag' : pikeWarn ? 'hip-pike' : 'spine-misaligned';
      debugLog('SIDEPLANK', 'TIMER', 'frozen', {
        reason,
        accumulatedSec: +(this.accumulatedValidMs / 1000).toFixed(1),
      });
    } else if (!formBroken && this.wasFormBroken) {
      debugLog('SIDEPLANK', 'TIMER', 'resumed', {
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
        debugLog('SIDEPLANK', 'WARN', 'not-moving', { brokenForMs: brokenFor });
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

    const metrics: SidePlankFrameMetrics = {
      hipSagAmount: Math.max(0, this.smoothedHipDelta),
      hipPikeAmount: Math.max(0, -this.smoothedHipDelta),
      spineDeviationDeg: this.smoothedSpineDeg,
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
      debugLog('SIDEPLANK', 'TICK', `Tick ${secondsElapsed}s`, {
        mqs,
        hipDelta: +this.smoothedHipDelta.toFixed(3),
        spine: +this.smoothedSpineDeg.toFixed(1),
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
    debugLog('SIDEPLANK', 'WARN', type);
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
    debugLog('SIDEPLANK', 'WARN', 'position-lost', { lostMs: Math.round(lostMs) });
    this.callbacks.onPostureWarning?.('position-lost');
  }
}
