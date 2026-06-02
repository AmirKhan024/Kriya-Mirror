/**
 * TandemStandEngine — hold-based balance tracker for tandem stance (heel-to-toe).
 *
 * Mirrors PlankEngine's hold lifecycle (calibration → continuous tracking →
 * 1Hz onHoldTick → onHoldBroken on collapse). The NEW infrastructure is the
 * SWAY-SCORE COMPUTATION per the BB5 clinical spec:
 *
 *   1. Per-frame CoM proxy = 0.6 × hipMid + 0.4 × shoulderMid
 *   2. EMA smooth the CoM (α = 0.30 — lower than movement engines)
 *   3. Capture a HOLD baseline from the first 10 valid frames of the hold
 *      (NOT calibration position — user may shift entering tandem)
 *   4. Per-frame sway displacement = dist(smoothedCoM, baseline) / shoulderWidth
 *   5. Per-frame sway angle = atan2(displacement, 1) × 180/π
 *
 * Distance-independence: ALWAYS normalize by baseline.shoulderWidth.
 */
import type { PoseLandmarks } from '@/modules/pose/types';
import type { WarningType } from '@/store/workout';
import { LM, lmVisible, midpoint, trunkLeanDeg, comProxy } from './geometry';
import { TandemStandCalibration } from './calibration';
import type { TandemStandBaseline, TandemStandEngineCallbacks, TandemStandFrameMetrics } from './types';
import { computeFormScore } from './scoring';
import { debugLog } from '@/lib/debug';

// 2026-05-25 round 12: dropped 0.30 → 0.20 for more aggressive CoM smoothing.
// Single-frame MediaPipe jitter was producing sway angles right at the warn
// threshold every other frame, chattering the timer freeze. Real postural
// sway lasting > 200ms still trips the 6-frame entry debounce.
const SMOOTHING_ALPHA = 0.20;
const HOLD_BASELINE_FRAMES = 10;          // mean of first 10 valid frames = baseline CoM (BB5 §1)

const SWAY_WARN_ANGLE_DEG = 6;            // clinical "moderate sway" threshold
const SWAY_WARN_FRAMES = 6;
const SWAY_RESUME_FRAMES = 6;             // round 12: sustained "good" frames before clearing the warn

const FEET_SEPARATED_RATIO = 0.45;        // ankleXDist / shoulderWidth → drifting out of tandem
const FEET_SEPARATED_FRAMES = 8;
const FEET_SEPARATED_RESUME_FRAMES = 8;   // round 12: paired exit debounce

// 2026-05-25 round 9: feet-separated is now a RECOVERABLE form warning that
// freezes the hold counter (mirrors swaying). The user can step back into
// stance and continue — the workout no longer auto-ends on foot drift.
// `HOLD_BROKEN_ANKLE_RATIO` was removed; only shoulder-rise terminates now.
const HOLD_BROKEN_SHOULDER_RISE = 0.15;   // shoulder rose this much vs cal → user stood up

// 2026-05-25 round 9: hands-off-hips — subtle coaching cue. Doesn't freeze
// the timer; respects a 12 s repeat cooldown so it doesn't spam.
// Thresholds mirror the vanilla-JS hip_gate reference (mobility_new/hip_gate).
const HANDS_OFF_HIPS_CONFIRM_MS = 2000;
const HANDS_OFF_HIPS_REPEAT_COOLDOWN_MS = 12_000;
const HANDS_OFF_HIPS_Y_TOL_FACTOR = 0.55;
const HANDS_OFF_HIPS_X_TOL_FACTOR = 0.85;
const HANDS_OFF_HIPS_TOL_FLOOR = 0.06;
const HANDS_OFF_HIPS_TOL_CEIL = 0.25;

// 2026-05-25 round 10: longest-hold streak debounce. A freeze edge only
// commits (ends the current streak) once form has been bad for ≥ this
// duration continuously. Sub-1s blips (sway brushing the threshold for
// a handful of frames) are absorbed into the ongoing streak — the user
// perceives them as part of one continuous hold, not as separate streaks.
const MIN_STREAK_BREAK_MS = 1000;

const FORM_SMOOTH_ALPHA = 0.15;           // smooth the per-frame form score
const TICK_INTERVAL_MS = 1000;
const WARNING_REPEAT_COOLDOWN_MS = 2500;

// 2026-05-25 round 6: position-lost detection — fire if no usable pose frame
// for ≥ 3 s post-cal, repeat every 10 s while still lost.
const POSITION_LOST_TIMEOUT_MS = 3000;
const POSITION_LOST_REPEAT_MS = 10_000;

// 2026-05-25 round 13: defensive floor on baseline.shoulderWidth at runtime.
// Calibration now rejects baselines below this (see calibration.ts); this
// guards every distance-normalized threshold against any path that might
// still leak a tiny value.
const MIN_SHOULDER_WIDTH_RUNTIME = 0.08;

export class TandemStandEngine {
  private callbacks: TandemStandEngineCallbacks;
  private calibration: TandemStandCalibration;
  private baseline: TandemStandBaseline | null = null;

  /** EMA-smoothed CoM proxy (the signal we measure sway against). */
  private smoothedComX = 0;
  private smoothedComY = 0;
  private smoothedComInitialized = false;

  /** Rolling-mean hold baseline (captured after calibration, from first
   *  HOLD_BASELINE_FRAMES valid frames). NULL until enough frames collected. */
  private holdBaselineComX: number | null = null;
  private holdBaselineComY: number | null = null;
  private holdBaselineFrames: Array<{ x: number; y: number }> = [];

  private smoothedFormScore = 100;

  // 2026-05-25 round 12: paired bad/good counters + sticky warn-state flags.
  // Stops MediaPipe single-frame jitter from chattering the timer-freeze on/off.
  private swayBadFrames = 0;
  private swayGoodFrames = 0;
  private swayWarnActive = false;
  private feetSepBadFrames = 0;
  private feetSepGoodFrames = 0;
  private feetSepWarnActive = false;

  private warningCooldowns: Partial<Record<WarningType, number>> = {};

  private holdStartAt: number | null = null;
  private lastTickAt = 0;
  private finished = false;
  private broken = false;

  // 2026-05-25 round 5 (HANDOFF §4.4 Fix B): "wrong gets discarded" — accumulate
  // only frames where form is currently OK. Mirror plank's freeze mechanic.
  // 2026-05-25 round 9: `feet-separated` now ALSO freezes (was previously a
  // hold-broken trigger). Both `swaying` AND `feet-separated` pause the counter.
  private accumulatedValidMs = 0;
  private lastFrameAt: number | null = null;
  private wasFormBroken = false;

  // 2026-05-25 round 9 + round 10: longest continuous unfrozen-form streak (ms).
  // The round-10 rewrite tracks ACCUMULATED VALID TIME in the current streak
  // (currentStreakValidMs) and only ends the streak when a freeze has lasted
  // ≥ MIN_STREAK_BREAK_MS continuously (streakBreakCommitted). Sub-1s blips
  // are absorbed — the user perceives them as part of one hold.
  private longestUnfrozenStreakMs = 0;
  private currentStreakValidMs = 0;
  private streakBreakStartedAt = 0;
  private streakBreakCommitted = false;

  // 2026-05-25 round 9: hands-off-hips coaching cue (cooldown-throttled).
  private handsOffHipsStartedAt = 0;
  private lastHandsOffHipsWarnAt = 0;

  // 2026-05-25 round 6: position-lost detection (tracking-validity heartbeat)
  private lastValidFrameAt = 0;
  private lastPositionLostWarnAt = 0;

  constructor(callbacks: TandemStandEngineCallbacks = {}) {
    this.callbacks = callbacks;
    this.calibration = new TandemStandCalibration();
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
        // 2026-05-25 round 10: longest-streak counter starts at 0 on cal-confirm;
        // valid time accumulates per frame inside processHoldFrame.
        debugLog('TANDEM', 'HOLD', 'Hold started — collecting baseline', {
          shoulderWidth: this.baseline ? +this.baseline.shoulderWidth.toFixed(3) : null,
        });
      }
      return;
    }

    // 2026-05-25 round 6: post-cal position-lost check runs regardless of
    // whether the current frame has usable landmarks (the whole point is to
    // detect missing frames).
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

    const ls = landmarks[LM.LEFT_SHOULDER];
    const rs = landmarks[LM.RIGHT_SHOULDER];
    const lh = landmarks[LM.LEFT_HIP];
    const rh = landmarks[LM.RIGHT_HIP];
    const la = landmarks[LM.LEFT_ANKLE];
    const ra = landmarks[LM.RIGHT_ANKLE];

    const coreOk = lmVisible(ls) && lmVisible(rs) && lmVisible(lh) && lmVisible(rh)
      && lmVisible(la) && lmVisible(ra);
    if (!coreOk) return;

    // Check for "user stood up out of stance" → hold broken
    const shoulderY = (ls.y + rs.y) / 2;
    const shoulderRise = baseline.shoulderY - shoulderY;
    if (shoulderRise > HOLD_BROKEN_SHOULDER_RISE) {
      this.fireHoldBroken('shoulder-rise', now, { shoulderRise });
      return;
    }

    // Per-frame CoM proxy
    const com = comProxy(ls, rs, lh, rh);

    // EMA smoothing (preserve B10 init pattern: first frame seeds from raw)
    if (!this.smoothedComInitialized) {
      this.smoothedComX = com.x;
      this.smoothedComY = com.y;
      this.smoothedComInitialized = true;
    } else {
      this.smoothedComX = SMOOTHING_ALPHA * com.x + (1 - SMOOTHING_ALPHA) * this.smoothedComX;
      this.smoothedComY = SMOOTHING_ALPHA * com.y + (1 - SMOOTHING_ALPHA) * this.smoothedComY;
    }

    // Build the HOLD baseline from the first HOLD_BASELINE_FRAMES smoothed-CoM samples.
    // Per BB5 spec: NOT from calibration position (the user may shift slightly entering tandem).
    if (this.holdBaselineComX === null) {
      this.holdBaselineFrames.push({ x: this.smoothedComX, y: this.smoothedComY });
      if (this.holdBaselineFrames.length >= HOLD_BASELINE_FRAMES) {
        const meanX = this.holdBaselineFrames.reduce((s, p) => s + p.x, 0) / this.holdBaselineFrames.length;
        const meanY = this.holdBaselineFrames.reduce((s, p) => s + p.y, 0) / this.holdBaselineFrames.length;
        this.holdBaselineComX = meanX;
        this.holdBaselineComY = meanY;
        debugLog('TANDEM', 'HOLD', 'Hold baseline captured', {
          baselineX: +meanX.toFixed(3),
          baselineY: +meanY.toFixed(3),
        });
      }
      // While building baseline, emit a minimal frame metric so the UI can update
      this.emitFrameMetrics(0, 0, 0, baseline.ankleXDistance, false);
      return;
    }

    // Sway displacement — distance-independent via shoulder-width normalization
    const baseComX = this.holdBaselineComX;
    const baseComY = this.holdBaselineComY!;
    const dx = this.smoothedComX - baseComX;
    const dy = this.smoothedComY - baseComY;
    // 2026-05-25 round 13: floor shoulderWidth so degenerate baselines can't
    // collapse the threshold to within MediaPipe noise.
    const refShoulderWidth = Math.max(baseline.shoulderWidth, MIN_SHOULDER_WIDTH_RUNTIME);
    const rawDisplacement = Math.hypot(dx, dy) / refShoulderWidth;
    const swayAngleDeg = Math.atan2(rawDisplacement, 1.0) * (180 / Math.PI);

    // Trunk lean
    const trunkDeg = trunkLeanDeg(midpoint(ls, rs), midpoint(lh, rh));

    // Tandem drift: ankle x-distance relative to shoulder width
    const ankleXDist = Math.abs(la.x - ra.x);
    const ankleXRatio = refShoulderWidth > 0 ? ankleXDist / refShoulderWidth : 0;

    // 2026-05-25 round 9: feet-separated no longer terminates the hold. It
    // fires a warning + freezes the counter (see formBroken below), and the
    // user can recover by stepping back into tandem. Only shoulder-rise
    // (handled above) ends the hold structurally.

    // 2026-05-25 round 12: paired entry/exit debounce + sticky warn state.
    // Stops single-frame MediaPipe jitter from chattering the warn on/off.
    const swayBad = swayAngleDeg > SWAY_WARN_ANGLE_DEG;
    const feetSepBad = ankleXRatio > FEET_SEPARATED_RATIO;

    this.swayBadFrames = swayBad ? this.swayBadFrames + 1 : 0;
    this.swayGoodFrames = swayBad ? 0 : this.swayGoodFrames + 1;
    if (!this.swayWarnActive && this.swayBadFrames >= SWAY_WARN_FRAMES) {
      this.swayWarnActive = true;
    } else if (this.swayWarnActive && this.swayGoodFrames >= SWAY_RESUME_FRAMES) {
      this.swayWarnActive = false;
    }
    this.feetSepBadFrames = feetSepBad ? this.feetSepBadFrames + 1 : 0;
    this.feetSepGoodFrames = feetSepBad ? 0 : this.feetSepGoodFrames + 1;
    if (!this.feetSepWarnActive && this.feetSepBadFrames >= FEET_SEPARATED_FRAMES) {
      this.feetSepWarnActive = true;
    } else if (this.feetSepWarnActive && this.feetSepGoodFrames >= FEET_SEPARATED_RESUME_FRAMES) {
      this.feetSepWarnActive = false;
    }

    const swayWarn = this.swayWarnActive;
    const feetSepWarn = this.feetSepWarnActive;

    this.maybeEmitWarning('swaying', swayWarn, now);
    this.maybeEmitWarning('feet-separated', feetSepWarn, now);

    // Form score (smoothed)
    const rawFormScore = computeFormScore(
      swayAngleDeg,
      trunkDeg,
      ankleXDist,
      baseline.ankleXDistance,
    );
    this.smoothedFormScore = (1 - FORM_SMOOTH_ALPHA) * this.smoothedFormScore + FORM_SMOOTH_ALPHA * rawFormScore;

    // 2026-05-25 round 5 (HANDOFF §4.4 Fix B + Fix E): accumulate only frames
    // where form is currently OK.
    // 2026-05-25 round 9: BOTH `swaying` AND `feet-separated` freeze the counter.
    // feet-separated was previously a hold-broken trigger; now it's recoverable.
    const formBroken = swayWarn || feetSepWarn;
    const dtMs = this.lastFrameAt !== null ? now - this.lastFrameAt : 0;
    if (!formBroken && dtMs > 0 && dtMs < 200) {
      this.accumulatedValidMs += dtMs;
    }
    this.lastFrameAt = now;
    if (formBroken && !this.wasFormBroken) {
      debugLog('TANDEM', 'TIMER', 'frozen', {
        reason: feetSepWarn ? 'feet-separated' : 'swaying',
        accumulatedSec: +(this.accumulatedValidMs / 1000).toFixed(1),
      });
    } else if (!formBroken && this.wasFormBroken) {
      debugLog('TANDEM', 'TIMER', 'resumed', {
        accumulatedSec: +(this.accumulatedValidMs / 1000).toFixed(1),
      });
    }
    this.wasFormBroken = formBroken;

    // 2026-05-25 round 10: longest-streak accounting. A freeze blip < 1s
    // doesn't end the streak — the valid-time accumulator continues across
    // the gap. Only a sustained ≥ 1s break commits the streak.
    if (!formBroken) {
      if (this.streakBreakCommitted) {
        // Resuming after a committed (sustained) break → start fresh streak.
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

    // 2026-05-25 round 9: hands-off-hips coaching cue. Does NOT freeze the
    // timer — purely a verbal nudge. 12 s cooldown between fires so it
    // doesn't spam during a sustained off-hips period.
    this.evaluateHandsOffHips(landmarks, now);

    this.emitFrameMetrics(swayAngleDeg, rawDisplacement, trunkDeg, ankleXDist, false);

    // 1Hz tick — secondsElapsed reflects VALID hold time (frozen during
    // sustained sway / feet-separated), not wall-clock elapsed.
    if (now - this.lastTickAt >= TICK_INTERVAL_MS) {
      this.lastTickAt = now;
      const secondsElapsed = Math.floor(this.accumulatedValidMs / 1000);
      const mqs = Math.round(this.smoothedFormScore);
      const longestUnfrozenSec = Math.max(
        Math.floor(this.longestUnfrozenStreakMs / 1000),
        Math.floor(this.currentStreakValidMs / 1000),
      );
      debugLog('TANDEM', 'TICK', `Tick ${secondsElapsed}s`, {
        mqs,
        sway: +swayAngleDeg.toFixed(2),
        longestUnfrozenSec,
      });
      this.callbacks.onHoldTick?.({ secondsElapsed, mqs, longestUnfrozenSec });
    }
  }

  private fireHoldBroken(reason: string, now: number, extra: Record<string, unknown>): void {
    if (this.broken) return;
    this.broken = true;
    const atSec = this.holdStartAt ? Math.floor((now - this.holdStartAt) / 1000) : 0;
    debugLog('TANDEM', 'BROKEN', 'Hold ended early', { reason, atSec, ...extra });
    this.maybeEmitWarning('hold-broken', true, now);
    this.callbacks.onHoldBroken?.();
    this.finish();
  }

  private emitFrameMetrics(
    swayAngleDeg: number,
    swayDisplacement: number,
    trunkLeanDegrees: number,
    ankleXDistance: number,
    isHoldBroken: boolean,
  ): void {
    const metrics: TandemStandFrameMetrics = {
      swayAngleDeg,
      swayDisplacement,
      trunkLeanDeg: trunkLeanDegrees,
      ankleXDistance,
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
    debugLog('TANDEM', 'WARN', type);
    this.callbacks.onPostureWarning?.(type);
  }

  // ----------------------------------------------------------
  // 2026-05-25 round 9: hands-off-hips coaching cue
  // ----------------------------------------------------------

  /** Proximity-based check: BOTH wrists must be near their corresponding hip
   *  in X and Y (dynamic tolerances scaled to body size). Returns `null` when
   *  wrists aren't visible — we silently skip the check in that case rather
   *  than penalise the user for partial visibility.
   *
   *  The vanilla-JS hip_gate reference adds an "akimbo" elbow-bend check on
   *  top of this. Omitted for now — physical-test will tell us if proximity
   *  alone false-negatives on relaxed-arms-at-sides poses. */
  private areHandsOnHips(landmarks: PoseLandmarks): boolean | null {
    const lh = landmarks[LM.LEFT_HIP];
    const rh = landmarks[LM.RIGHT_HIP];
    const ls = landmarks[LM.LEFT_SHOULDER];
    const rs = landmarks[LM.RIGHT_SHOULDER];
    const lw = landmarks[LM.LEFT_WRIST];
    const rw = landmarks[LM.RIGHT_WRIST];
    if (!lmVisible(lw) || !lmVisible(rw)) return null;

    const hipMidY = (lh.y + rh.y) / 2;
    const shoulderMidY = (ls.y + rs.y) / 2;
    const torsoHeight = Math.abs(hipMidY - shoulderMidY);
    const hipDist = Math.abs(lh.x - rh.x);

    const yTol = Math.min(
      HANDS_OFF_HIPS_TOL_CEIL,
      Math.max(HANDS_OFF_HIPS_TOL_FLOOR, HANDS_OFF_HIPS_Y_TOL_FACTOR * torsoHeight),
    );
    const xTol = Math.min(
      HANDS_OFF_HIPS_TOL_CEIL,
      Math.max(HANDS_OFF_HIPS_TOL_FLOOR, HANDS_OFF_HIPS_X_TOL_FACTOR * hipDist),
    );

    const leftWristNearHip = Math.abs(lw.y - lh.y) < yTol && Math.abs(lw.x - lh.x) < xTol;
    const rightWristNearHip = Math.abs(rw.y - rh.y) < yTol && Math.abs(rw.x - rh.x) < xTol;
    return leftWristNearHip && rightWristNearHip;
  }

  private evaluateHandsOffHips(landmarks: PoseLandmarks, now: number): void {
    const handsOn = this.areHandsOnHips(landmarks);
    if (handsOn === null) return;  // can't tell — leave timers untouched
    if (handsOn) {
      this.handsOffHipsStartedAt = 0;
      return;
    }
    if (this.handsOffHipsStartedAt === 0) this.handsOffHipsStartedAt = now;
    const sustainedMs = now - this.handsOffHipsStartedAt;
    if (sustainedMs < HANDS_OFF_HIPS_CONFIRM_MS) return;
    const sinceLastWarn = now - this.lastHandsOffHipsWarnAt;
    const firstFireAllowed = this.lastHandsOffHipsWarnAt === 0
      || sinceLastWarn >= HANDS_OFF_HIPS_REPEAT_COOLDOWN_MS;
    if (!firstFireAllowed) return;
    this.lastHandsOffHipsWarnAt = now;
    debugLog('TANDEM', 'WARN', 'hands-off-hips', { sustainedMs: Math.round(sustainedMs) });
    this.callbacks.onPostureWarning?.('hands-off-hips');
  }

  // ----------------------------------------------------------
  // 2026-05-25 round 6: position-lost detection
  // ----------------------------------------------------------

  /** Mirrors the coreOk check inside processHoldFrame so the position-lost
   *  detection uses the same definition of "usable frame". Tandem stand's
   *  core set is shoulders + hips + knees + ankles. */
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
    debugLog('TANDEM', 'WARN', 'position-lost', { lostMs: Math.round(lostMs) });
    this.callbacks.onPostureWarning?.('position-lost');
  }
}
