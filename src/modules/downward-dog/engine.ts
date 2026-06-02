/**
 * DownwardDogEngine (Adho Mukha Svanasana) — hold-based, side-profile.
 *
 * No rep state machine. The user calibrates IN the inverted-V pose, then holds
 * it. Per frame the engine computes one pure geometric angle from the camera-
 * side shoulder / hip / ankle:
 *   apexAngle = the interior angle at the hip (~90° = sharp inverted V,
 *               opening toward 180° as the hips drop into a flat/plank line).
 *
 * Emits:
 *   - onCalibrationUpdate while calibrating
 *   - onHoldTick({ secondsElapsed, mqs, longestUnfrozenSec }) once per second
 *   - onPostureWarning(type) with cooldown throttling
 *   - onHoldBroken() when the inverted V fully collapses (hips drop / user stands up)
 *
 * The single recoverable form-break (Fix S) FREEZES the hold counter but never
 * terminates:
 *   - hip-sag : the apex angle opened past the hold threshold (hips dropping)
 * Only the V fully flattening (apex past APEX_BROKEN) terminates the hold.
 *
 * Knees are deliberately not gated — Down Dog tolerates bent knees (tight
 * hamstrings), so a knee warning would be a false positive.
 *
 * Mirrors standing-forward-fold's hold lifecycle: paired warn-state hysteresis
 * (Fix V), EMA α = 0.20 (Fix W), longest-streak debounce (Fix U), position-lost
 * detection (Fix N), TIMER frozen/resumed logs (Fix E).
 */
import type { PoseLandmarks } from '@/modules/pose/types';
import type { WarningType } from '@/store/workout';
import { LM, lmVisible, kneeFlexionDeg } from '@/modules/squat/geometry';
import { elbowFlexionDeg } from '@/modules/pushup/geometry';
import { DownwardDogCalibration } from './calibration';
import type { DownwardDogBaseline, DownwardDogEngineCallbacks, DownwardDogFrameMetrics } from './types';
import { getHipSagPenalty } from './scoring';
import { debugLog } from '@/lib/debug';

// 2026-05-25 round 12 (Fix W): 0.20 — softer smoothing for noisy hold engines.
const EMA_ALPHA = 0.20;

// Hip apex thresholds (interior angle at the hip, degrees).
const APEX_HOLD_MAX = 115;   // accumulate valid hold while apex ≤ this (sharp V)
const APEX_BROKEN = 150;     // apex > this → V fully collapsed → hold-broken

// 2026-05-25 round 12 (Fix V): paired entry/exit hysteresis so MediaPipe
// single-frame jitter can't chatter the timer freeze on/off.
const HIP_SAG_WARN_FRAMES = 6;
const HIP_SAG_RESUME_FRAMES = 6;

// 2026-05-31 physical-test fix: Down Dog is an inverted-V PEAK with the legs and
// arms straight. Gate knee + arm straightness — tolerant of minor bend/sway, but
// freeze the timer once a limb is clearly bent (0° = straight; tune these).
const KNEE_BENT_MAX_DEG = 28;   // knee flexion above this → legs not straight
const ARM_BENT_MAX_DEG = 28;    // elbow flexion above this → arms not straight
const STRAIGHT_WARN_FRAMES = 6;
const STRAIGHT_RESUME_FRAMES = 6;

const FORM_SMOOTH_ALPHA = 0.15;
const TICK_INTERVAL_MS = 1000;
const WARNING_REPEAT_COOLDOWN_MS = 2500;

// 2026-05-25 round 6 (Fix N): position-lost detection.
const POSITION_LOST_TIMEOUT_MS = 3000;
const POSITION_LOST_REPEAT_MS = 10_000;

// 2026-05-25 round 10 (Fix U): a freeze blip shorter than this is absorbed into
// the ongoing longest-hold streak rather than ending it.
const MIN_STREAK_BREAK_MS = 1000;

export class DownwardDogEngine {
  private callbacks: DownwardDogEngineCallbacks;
  private calibration: DownwardDogCalibration;
  private baseline: DownwardDogBaseline | null = null;

  private smoothedApexDeg = 0;
  private smoothedInitialized = false;
  private smoothedFormScore = 100;

  // Fix V: paired bad/good counters + sticky warn flag.
  private hipSagBadFrames = 0;
  private hipSagGoodFrames = 0;
  private hipSagWarnActive = false;

  // Leg / arm straightness gates (EMA-smoothed flexion + paired hysteresis).
  private smoothedKneeDeg = 0;
  private smoothedArmDeg = 0;
  private kneeBadFrames = 0;
  private kneeGoodFrames = 0;
  private kneeBentWarnActive = false;
  private armBadFrames = 0;
  private armGoodFrames = 0;
  private armBentWarnActive = false;

  private warningCooldowns: Partial<Record<WarningType, number>> = {};

  private holdStartAt: number | null = null;
  private lastTickAt = 0;
  private finished = false;
  private broken = false;

  // Fix S/B: freeze the hold counter during the recoverable form-break.
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

  constructor(callbacks: DownwardDogEngineCallbacks = {}) {
    this.callbacks = callbacks;
    this.calibration = new DownwardDogCalibration();
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
        debugLog('DOG', 'HOLD', 'Hold started', {
          side: this.baseline?.side,
          legDropY: this.baseline ? +this.baseline.legDropY.toFixed(3) : null,
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
    const ankle = landmarks[side === 'left' ? LM.LEFT_ANKLE : LM.RIGHT_ANKLE];
    const knee = landmarks[side === 'left' ? LM.LEFT_KNEE : LM.RIGHT_KNEE];
    const elbow = landmarks[side === 'left' ? LM.LEFT_ELBOW : LM.RIGHT_ELBOW];
    const wrist = landmarks[side === 'left' ? LM.LEFT_WRIST : LM.RIGHT_WRIST];

    if (!lmVisible(shoulder) || !lmVisible(hip) || !lmVisible(ankle)) return;

    // Hip apex interior angle (~90 sharp V, →180 flat). kneeFlexionDeg(a,vertex,b)
    // returns 180 − interiorAngle(vertex), so the hip interior angle is its complement.
    const apexDeg = 180 - kneeFlexionDeg(shoulder, hip, ankle);

    if (!this.smoothedInitialized) {
      this.smoothedApexDeg = apexDeg;
      this.smoothedInitialized = true;
    } else {
      this.smoothedApexDeg = EMA_ALPHA * apexDeg + (1 - EMA_ALPHA) * this.smoothedApexDeg;
    }

    // Hold broken: the inverted V fully collapsed (apex opened toward flat /
    // user stood up). The only terminal condition — hip-sag below is recoverable.
    if (this.smoothedApexDeg > APEX_BROKEN) {
      this.fireHoldBroken('flattened', now, { apexDeg: +this.smoothedApexDeg.toFixed(1) });
      return;
    }

    // Recoverable form-break (hips dropping), with paired entry/exit hysteresis (Fix V).
    const hipSagBad = this.smoothedApexDeg > APEX_HOLD_MAX;
    this.hipSagBadFrames = hipSagBad ? this.hipSagBadFrames + 1 : 0;
    this.hipSagGoodFrames = hipSagBad ? 0 : this.hipSagGoodFrames + 1;
    if (!this.hipSagWarnActive && this.hipSagBadFrames >= HIP_SAG_WARN_FRAMES) {
      this.hipSagWarnActive = true;
    } else if (this.hipSagWarnActive && this.hipSagGoodFrames >= HIP_SAG_RESUME_FRAMES) {
      this.hipSagWarnActive = false;
    }
    const hipSagWarn = this.hipSagWarnActive;

    this.maybeEmitWarning('hip-sag', hipSagWarn, now);

    // Legs straight: knee flexion (only when the knee is visible). Allow minor
    // bend/sway; freeze once clearly bent. Paired hysteresis (Fix V).
    let kneeBentWarn = this.kneeBentWarnActive;
    if (lmVisible(knee)) {
      const kneeFlex = kneeFlexionDeg(hip, knee, ankle);
      this.smoothedKneeDeg = EMA_ALPHA * kneeFlex + (1 - EMA_ALPHA) * this.smoothedKneeDeg;
      const kneeBad = this.smoothedKneeDeg > KNEE_BENT_MAX_DEG;
      this.kneeBadFrames = kneeBad ? this.kneeBadFrames + 1 : 0;
      this.kneeGoodFrames = kneeBad ? 0 : this.kneeGoodFrames + 1;
      if (!this.kneeBentWarnActive && this.kneeBadFrames >= STRAIGHT_WARN_FRAMES) {
        this.kneeBentWarnActive = true;
      } else if (this.kneeBentWarnActive && this.kneeGoodFrames >= STRAIGHT_RESUME_FRAMES) {
        this.kneeBentWarnActive = false;
      }
      kneeBentWarn = this.kneeBentWarnActive;
    }
    this.maybeEmitWarning('leg-not-straight', kneeBentWarn, now);

    // Arms straight: elbow flexion (only when elbow + wrist are visible).
    let armBentWarn = this.armBentWarnActive;
    if (lmVisible(elbow) && lmVisible(wrist)) {
      const armFlex = elbowFlexionDeg(shoulder, elbow, wrist);
      this.smoothedArmDeg = EMA_ALPHA * armFlex + (1 - EMA_ALPHA) * this.smoothedArmDeg;
      const armBad = this.smoothedArmDeg > ARM_BENT_MAX_DEG;
      this.armBadFrames = armBad ? this.armBadFrames + 1 : 0;
      this.armGoodFrames = armBad ? 0 : this.armGoodFrames + 1;
      if (!this.armBentWarnActive && this.armBadFrames >= STRAIGHT_WARN_FRAMES) {
        this.armBentWarnActive = true;
      } else if (this.armBentWarnActive && this.armGoodFrames >= STRAIGHT_RESUME_FRAMES) {
        this.armBentWarnActive = false;
      }
      armBentWarn = this.armBentWarnActive;
    }
    this.maybeEmitWarning('arms-not-straight', armBentWarn, now);

    // Form score (smoothed).
    const rawFormScore = Math.max(0, 100 - getHipSagPenalty(this.smoothedApexDeg));
    this.smoothedFormScore = (1 - FORM_SMOOTH_ALPHA) * this.smoothedFormScore + FORM_SMOOTH_ALPHA * rawFormScore;

    // Fix B/S/E: accumulate only frames where form is currently OK. Any of the
    // recoverable form-breaks (hips dropping, legs bending, arms bending) freezes
    // the counter; the user recovers by re-forming the straight-limbed peak.
    const formBroken = hipSagWarn || kneeBentWarn || armBentWarn;
    const dtMs = this.lastFrameAt !== null ? now - this.lastFrameAt : 0;
    if (!formBroken && dtMs > 0 && dtMs < 200) {
      this.accumulatedValidMs += dtMs;
    }
    this.lastFrameAt = now;
    if (formBroken && !this.wasFormBroken) {
      const reason = hipSagWarn ? 'hip-sag' : kneeBentWarn ? 'leg-not-straight' : 'arms-not-straight';
      debugLog('DOG', 'TIMER', 'frozen', {
        reason,
        accumulatedSec: +(this.accumulatedValidMs / 1000).toFixed(1),
      });
    } else if (!formBroken && this.wasFormBroken) {
      debugLog('DOG', 'TIMER', 'resumed', {
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
      debugLog('DOG', 'TICK', `Tick ${secondsElapsed}s`, {
        mqs,
        apex: +this.smoothedApexDeg.toFixed(1),
        longestUnfrozenSec,
      });
      this.callbacks.onHoldTick?.({ secondsElapsed, mqs, longestUnfrozenSec });
    }
  }

  private fireHoldBroken(reason: string, now: number, extra: Record<string, unknown>): void {
    if (this.broken) return;
    this.broken = true;
    const atSec = this.holdStartAt ? Math.floor((now - this.holdStartAt) / 1000) : 0;
    debugLog('DOG', 'BROKEN', 'Hold ended early', { reason, atSec, ...extra });
    this.maybeEmitWarning('hold-broken', true, now);
    this.callbacks.onHoldBroken?.();
    this.finish();
  }

  private emitFrameMetrics(isHoldBroken: boolean): void {
    const metrics: DownwardDogFrameMetrics = {
      apexAngleDeg: this.smoothedApexDeg,
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
    debugLog('DOG', 'WARN', type);
    this.callbacks.onPostureWarning?.(type);
  }

  // ----------------------------------------------------------
  // Fix N: position-lost detection
  // ----------------------------------------------------------

  /** Core set = the camera-side shoulder + hip + ankle (the landmarks
   *  processHoldFrame needs). */
  private hasCoreLandmarks(landmarks: PoseLandmarks): boolean {
    const side = this.baseline?.side;
    const check = (s: 'left' | 'right') =>
      lmVisible(landmarks[s === 'left' ? LM.LEFT_SHOULDER : LM.RIGHT_SHOULDER])
      && lmVisible(landmarks[s === 'left' ? LM.LEFT_HIP : LM.RIGHT_HIP])
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
    debugLog('DOG', 'WARN', 'position-lost', { lostMs: Math.round(lostMs) });
    this.callbacks.onPostureWarning?.('position-lost');
  }
}
