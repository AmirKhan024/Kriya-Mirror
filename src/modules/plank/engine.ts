/**
 * PlankEngine — continuous form tracker for static-hold exercises.
 *
 * No rep state machine. Per-frame it computes form deviations (hip sag, hip
 * pike, spine misalignment, neck droop), smooths via EMA, and emits:
 *   - `onCalibrationUpdate` while calibrating
 *   - `onHoldTick({ secondsElapsed, mqs })` once per second after calibration
 *   - `onPostureWarning(type)` with cooldown-throttled emissions
 *   - `onHoldBroken()` if the user collapses (shoulder rises toward standing)
 *
 * Reuses warning + cooldown patterns from `src/modules/squat/engine.ts`.
 */
import type { PoseLandmarks } from '@/modules/pose/types';
import type { WarningType } from '@/store/workout';
import { LM, lmVisible } from '@/modules/squat/geometry';
import { PlankCalibration } from './calibration';
import type { PlankBaseline, PlankEngineCallbacks, PlankFrameMetrics } from './types';
import { debugLog } from '@/lib/debug';

// Thresholds (normalized image coordinates; tunable)
const EMA_ALPHA = 0.20;
const HIP_SAG_THRESHOLD = 0.04;          // hipY > baselineHipY + this → sagging
const HIP_PIKE_THRESHOLD = 0.04;         // hipY < baselineHipY - this → piked
const SPINE_DEVIATION_DEG = 12;          // shoulder→hip→ankle line bend
const NECK_DROOP_THRESHOLD = 0.06;       // nose.y - shoulder.y > this → droop
const HOLD_BROKEN_SHOULDER_RISE = 0.18;  // shoulder.y rose this much vs baseline → user stood up

const WARNING_REPEAT_COOLDOWN_MS = 2500;
const NO_FORM_OK_FRAMES = 6;            // require sustained deviation before warning
const TICK_INTERVAL_MS = 1000;

export class PlankEngine {
  private callbacks: PlankEngineCallbacks;
  private calibration: PlankCalibration;
  private baseline: PlankBaseline | null = null;

  private smoothedHipDelta = 0;          // EMA of (hipY - baseline.hipY)
  private smoothedSpineDeg = 0;          // EMA of spine bend
  private smoothedNeckDroop = 0;
  private smoothedFormScore = 100;

  private hipSagBadFrames = 0;
  private hipPikeBadFrames = 0;
  private spineBadFrames = 0;
  private neckBadFrames = 0;
  private offSideBadFrames = 0;

  private warningCooldowns: Partial<Record<WarningType, number>> = {};

  private holdStartAt: number | null = null;
  private lastTickAt = 0;
  private finished = false;
  private broken = false;

  // 2026-05-25 round 3: "wrong gets discarded" — accumulate only frames where
  // form is currently good. Sustained hip-sag / hip-pike / spine-misaligned
  // freezes the counter. Neck-droop is excluded (coaching cue, not structural).
  private accumulatedValidMs = 0;
  private lastFrameAt: number | null = null;
  private wasFormBroken = false;

  constructor(callbacks: PlankEngineCallbacks = {}) {
    this.callbacks = callbacks;
    this.calibration = new PlankCalibration();
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
        debugLog('PLANK', 'HOLD', 'Hold started', {
          side: this.baseline?.side,
          baselineHipY: this.baseline ? +this.baseline.hipY.toFixed(3) : null,
        });
      }
      return;
    }

    if (!landmarks || !this.baseline || !this.holdStartAt) return;
    this.processHoldFrame(landmarks, now);
  }

  finish(): void { this.finished = true; }

  /** Hold-based engines don't have sets; this is a no-op for interface compat. */
  resetForNextSet(): void { /* noop */ }

  // ----------------------------------------------------------
  private processHoldFrame(landmarks: PoseLandmarks, now: number): void {
    const baseline = this.baseline!;
    const side = baseline.side;

    const shoulder = landmarks[side === 'left' ? LM.LEFT_SHOULDER : LM.RIGHT_SHOULDER];
    const hip = landmarks[side === 'left' ? LM.LEFT_HIP : LM.RIGHT_HIP];
    const ankle = landmarks[side === 'left' ? LM.LEFT_ANKLE : LM.RIGHT_ANKLE];
    const nose = landmarks[LM.NOSE];

    if (!lmVisible(shoulder) || !lmVisible(hip) || !lmVisible(ankle)) return;

    // Hold broken? Shoulder rose dramatically vs baseline → user stood up.
    const shoulderRise = baseline.shoulderY - shoulder.y;
    if (shoulderRise > HOLD_BROKEN_SHOULDER_RISE) {
      if (!this.broken) {
        this.broken = true;
        const atSec = this.holdStartAt ? Math.floor((now - this.holdStartAt) / 1000) : 0;
        debugLog('PLANK', 'BROKEN', 'Hold ended early', {
          atSec,
          shoulderRise: +shoulderRise.toFixed(3),
        });
        this.maybeEmitWarning('hold-broken', true, now);
        this.callbacks.onHoldBroken?.();
        this.finish();
      }
      return;
    }

    // Hip delta from baseline level (positive = sagging below)
    const hipDelta = hip.y - baseline.hipY;
    this.smoothedHipDelta = EMA_ALPHA * hipDelta + (1 - EMA_ALPHA) * this.smoothedHipDelta;

    // Spine bend: angle between shoulder→hip and hip→ankle vectors.
    // The two vectors are parallel (same direction) when the spine is perfectly
    // straight, so atan2(cross, dot) returns 0°. As the spine bends at the hip,
    // the angle increases. So bendDeg IS the deviation directly — no `180 - x`.
    const v1x = hip.x - shoulder.x, v1y = hip.y - shoulder.y;
    const v2x = ankle.x - hip.x, v2y = ankle.y - hip.y;
    const dot = v1x * v2x + v1y * v2y;
    const cross = Math.abs(v1x * v2y - v1y * v2x);
    const spineDeviation = Math.atan2(cross, dot) * (180 / Math.PI);
    this.smoothedSpineDeg = EMA_ALPHA * spineDeviation + (1 - EMA_ALPHA) * this.smoothedSpineDeg;

    // Neck droop: how far nose hangs below shoulder
    const neckDroop = lmVisible(nose) ? Math.max(0, nose.y - shoulder.y) : 0;
    this.smoothedNeckDroop = EMA_ALPHA * neckDroop + (1 - EMA_ALPHA) * this.smoothedNeckDroop;

    // Posture warnings with sustained-frame debounce
    const sagging = this.smoothedHipDelta > HIP_SAG_THRESHOLD;
    const piked = this.smoothedHipDelta < -HIP_PIKE_THRESHOLD;
    const spineBad = this.smoothedSpineDeg > SPINE_DEVIATION_DEG;
    const neckBad = this.smoothedNeckDroop > NECK_DROOP_THRESHOLD;

    this.hipSagBadFrames = sagging ? this.hipSagBadFrames + 1 : 0;
    this.hipPikeBadFrames = piked ? this.hipPikeBadFrames + 1 : 0;
    this.spineBadFrames = spineBad ? this.spineBadFrames + 1 : 0;
    this.neckBadFrames = neckBad ? this.neckBadFrames + 1 : 0;

    const sagWarn = this.hipSagBadFrames >= NO_FORM_OK_FRAMES;
    const pikeWarn = this.hipPikeBadFrames >= NO_FORM_OK_FRAMES;
    const spineWarn = this.spineBadFrames >= NO_FORM_OK_FRAMES;
    const neckWarn = this.neckBadFrames >= NO_FORM_OK_FRAMES;

    // Form score: penalize for each active deviation
    const sagPenalty = sagWarn ? Math.min(40, this.smoothedHipDelta * 600) : 0;
    const pikePenalty = pikeWarn ? Math.min(40, -this.smoothedHipDelta * 600) : 0;
    const spinePenalty = spineWarn ? Math.min(40, (this.smoothedSpineDeg - SPINE_DEVIATION_DEG) * 2) : 0;
    const neckPenalty = neckWarn ? 10 : 0;
    const rawFormScore = Math.max(0, 100 - sagPenalty - pikePenalty - spinePenalty - neckPenalty);
    this.smoothedFormScore = 0.85 * this.smoothedFormScore + 0.15 * rawFormScore;

    // Emit warnings (Rule A queue handled by play page; we just fire-and-forget per type)
    this.maybeEmitWarning('hip-sag', sagWarn, now);
    this.maybeEmitWarning('hip-pike', pikeWarn, now);
    this.maybeEmitWarning('spine-misaligned', spineWarn, now);
    this.maybeEmitWarning('neck-droop', neckWarn, now);

    // 2026-05-25 round 3: accumulate only when form is currently OK. Skip
    // neck-droop — it's a coaching cue, not a structural failure.
    const formBroken = sagWarn || pikeWarn || spineWarn;
    const dtMs = this.lastFrameAt !== null ? now - this.lastFrameAt : 0;
    if (!formBroken && dtMs > 0 && dtMs < 200) {
      this.accumulatedValidMs += dtMs;
    }
    this.lastFrameAt = now;
    if (formBroken && !this.wasFormBroken) {
      const reason = sagWarn ? 'hip-sag' : pikeWarn ? 'hip-pike' : 'spine-misaligned';
      debugLog('PLANK', 'TIMER', 'frozen', {
        reason,
        accumulatedSec: +(this.accumulatedValidMs / 1000).toFixed(1),
      });
    } else if (!formBroken && this.wasFormBroken) {
      debugLog('PLANK', 'TIMER', 'resumed', {
        accumulatedSec: +(this.accumulatedValidMs / 1000).toFixed(1),
      });
    }
    this.wasFormBroken = formBroken;

    const metrics: PlankFrameMetrics = {
      hipSagAmount: Math.max(0, this.smoothedHipDelta),
      hipPikeAmount: Math.max(0, -this.smoothedHipDelta),
      spineDeviationDeg: this.smoothedSpineDeg,
      neckDroopAmount: this.smoothedNeckDroop,
      formScore: this.smoothedFormScore,
      isHoldBroken: false,
    };
    this.callbacks.onFrame?.(metrics);

    // 1Hz tick: emit hold-tick with current form sample.
    // 2026-05-25 round 3: secondsElapsed reflects VALID hold time (frozen
    // counter during sustained bad form), not wall-clock elapsed.
    if (now - this.lastTickAt >= TICK_INTERVAL_MS) {
      this.lastTickAt = now;
      const secondsElapsed = Math.floor(this.accumulatedValidMs / 1000);
      const mqs = Math.round(this.smoothedFormScore);
      debugLog('PLANK', 'TICK', `Tick ${secondsElapsed}s`, { mqs });
      this.callbacks.onHoldTick?.({ secondsElapsed, mqs });
    }
  }

  private maybeEmitWarning(type: WarningType, active: boolean, now: number): void {
    if (!active) return;
    const last = this.warningCooldowns[type] ?? 0;
    if (now - last < WARNING_REPEAT_COOLDOWN_MS) return;
    this.warningCooldowns[type] = now;
    debugLog('PLANK', 'WARN', type);
    this.callbacks.onPostureWarning?.(type);
  }
}
