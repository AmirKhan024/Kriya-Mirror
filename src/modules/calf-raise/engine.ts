/**
 * CalfRaiseEngine — 2026-05-28 round 22 re-architecture.
 *
 * Previously: rep-based "up-down-up-down" state machine. User reported
 * MediaPipe heel-detection asymmetry caused most reps to be rejected as
 * `unilateral` even when both feet lifted, and the user determined the
 * exercise concept itself was wrong — calf raises are typically held, not
 * cycled. Round 22 pivots to HOLD-based.
 *
 * Now: heel-rise HOLD. User rises onto balls of feet once and holds for the
 * target duration. Engine tracks cumulative `HOLDING` time; transient drops
 * pause the timer + emit `heel-dropped` (cooldown-throttled), DO NOT
 * terminate the hold. Only sustained position-loss triggers `onHoldBroken`.
 *
 * Reference: BB6 heel-rise-hold (`kriya-activities/balance_new/heel_rise_hold`)
 *   - α = 0.12 EMA on per-side ankle Y (tight; rejects MP jitter)
 *   - 60-frame warmup before adaptive percentile-based drop threshold
 *   - Bilateral max(L, R) elevation — single-foot artifacts don't fire drops
 *   - 8-frame confirmation before transitioning HOLDING → DROPPED
 *   - 30% hysteresis on recovery (DROPPED → HOLDING requires elevation > thr × 1.3)
 *
 * Callback shape mirrors PlankEngine:
 *   - onCalibrationUpdate    while calibrating
 *   - onHoldTick             1 Hz, after cal-confirm
 *   - onPostureWarning       'heel-dropped' (4 s cooldown), 'position-lost'
 *   - onHoldBroken           only on sustained position-lost > 10 s
 */
import type { PoseLandmarks } from '@/modules/pose/types';
import type { WarningType } from '@/store/workout';
import { LM, lmVisible } from './geometry';
import { CalfRaiseCalibration } from './calibration';
import type {
  CalfRaiseBaseline, CalfRaiseEngineCallbacks, CalfRaiseFrameMetrics, CalfRaiseHoldState,
} from './types';
import { computeMQS, getCompletionScore, getFormScore } from './scoring';
import { debugLog } from '@/lib/debug';

// ─── BB6-derived tuning constants ─────────────────────────────────────
const EMA_ALPHA_ELEVATION = 0.12;
const MAX_ANKLE_DELTA_PER_FRAME = 0.008;
const DROP_WARMUP_FRAMES = 60;
const DROP_PEAK_PERCENTILE = 0.90;
const DROP_RATIO = 0.50;
const DROP_HYSTERESIS_RATIO = 0.30;
const HEEL_DROP_MIN_FRAMES = 8;
// 2026-05-28 round 23: raised 0.015 → 0.030. Round-22 value made the initial
// SETTLING → HOLDING gate ≈0.5% of trunkLength (≈0.005 in normalized Y for
// the user's frame) — below typical MediaPipe ankle Y jitter. Engine
// registered noise as "rise complete" then dropped on noise, firing a false
// heel-dropped warning. 0.030 (~1% of trunkLength, ~2cm of real heel rise) is
// above the MP jitter floor while still catching a small intentional rise.
const RISE_THRESHOLD_TRUNK_FRAC = 0.030;
const RECOVERY_MIN_FRAMES = 4;            // DROPPED → HOLDING requires elevation > recovery threshold for 4 frames

// ─── Output cadence ───────────────────────────────────────────────────
const TICK_INTERVAL_MS = 1000;
const WARNING_REPEAT_COOLDOWN_MS = 4000;  // heel-dropped (user: "don't constantly fire it")

// ─── Position-lost (Fix N pattern, raised threshold for hold use) ─────
const POSITION_LOST_TIMEOUT_MS = 3000;
const POSITION_LOST_REPEAT_MS = 10_000;
const HOLD_BROKEN_POSITION_LOST_MS = 10_000;

// ─── Baseline drift correction (BB6 pattern) ──────────────────────────
const BASELINE_MEDIAN_SAMPLE_COUNT = 30;  // first 30 settling-phase samples → median ankle Y
const BASELINE_CORRECTION_CAP_FRAC = 0.05; // cap correction at ±5% of trunkLength

// Target duration is provided by the play page via `setTargetDurationSec()`
// (default 20 s per round-22 config).

export class CalfRaiseEngine {
  private callbacks: CalfRaiseEngineCallbacks;
  private calibration: CalfRaiseCalibration;
  private baseline: CalfRaiseBaseline | null = null;
  private targetDurationSec = 20;

  // EMA-smoothed per-side ankle Y, seeded from baseline at cal-confirm.
  private smoothedLeftAnkleY = 0;
  private smoothedRightAnkleY = 0;
  private prevRawLeftAnkleY = 0;
  private prevRawRightAnkleY = 0;
  private ankleSeeded = false;

  // Settling-phase ankle samples for the median-correction baseline tweak.
  private settlingLeftSamples: number[] = [];
  private settlingRightSamples: number[] = [];
  private baselineCorrectionApplied = false;

  // Adaptive drop threshold (BB6 pattern).
  private elevationHistory: number[] = [];
  private framesSinceCalibration = 0;
  private currentDropThreshold = 0;
  private framesSinceThresholdRecompute = 0;

  // Hold state machine.
  private holdState: CalfRaiseHoldState = 'SETTLING';
  private accumulatedHoldMs = 0;           // valid hold time, excluding DROPPED intervals
  private currentHoldingSegmentStartedAt = 0; // wall-clock when most recent HOLDING segment began
  private heelDropCount = 0;
  private dropConfirmFrames = 0;           // consecutive frames below dropThreshold (for HOLDING → DROPPED)
  private recoveryConfirmFrames = 0;       // consecutive frames above recovery (for DROPPED → HOLDING)

  // Form accumulation (elevation OK vs total).
  private formCounts = { elevationOKCount: 0, totalCount: 0 };
  // Smoothness placeholder — calf-raise hold has no continuous velocity signal
  // (we WANT zero motion). We default smoothness to a high value so the MQS
  // weighting still produces meaningful scores from form + completion.
  private smoothnessPlaceholder = 80;

  // 1 Hz tick.
  private lastTickAt = 0;

  // Position-lost detection.
  private lastValidFrameAt = 0;
  private lastPositionLostWarnAt = 0;

  private warningCooldowns: Partial<Record<WarningType, number>> = {};
  private finished = false;
  private broken = false;

  constructor(callbacks: CalfRaiseEngineCallbacks = {}) {
    this.callbacks = callbacks;
    this.calibration = new CalfRaiseCalibration();
  }

  /** Allow the play page (or test harness) to override the target hold duration
   *  used by the scoring. Defaults to 20 s per round-22 config. */
  setTargetDurationSec(sec: number): void {
    if (sec > 0) this.targetDurationSec = sec;
  }

  update(landmarks: PoseLandmarks | null, now: number): void {
    if (this.finished) return;

    if (!this.calibration.isConfirmed()) {
      const calUpdate = this.calibration.update(landmarks, now);
      this.callbacks.onCalibrationUpdate?.(calUpdate);
      if (calUpdate.state === 'confirmed') {
        this.baseline = this.calibration.getBaseline();
        if (this.baseline) {
          // Seed EMA from per-side baseline ankle Y.
          this.smoothedLeftAnkleY = this.baseline.baselineLeftAnkleY;
          this.smoothedRightAnkleY = this.baseline.baselineRightAnkleY;
          this.prevRawLeftAnkleY = this.baseline.baselineLeftAnkleY;
          this.prevRawRightAnkleY = this.baseline.baselineRightAnkleY;
          this.ankleSeeded = true;
          // Seed initial drop threshold from trunkLength × RISE_THRESHOLD_TRUNK_FRAC.
          this.currentDropThreshold = this.baseline.trunkLength * RISE_THRESHOLD_TRUNK_FRAC;
          this.lastTickAt = now;
          this.lastValidFrameAt = now;
          debugLog('CALF', 'HOLD', 'Hold started', {
            shoulderWidth: +this.baseline.shoulderWidth.toFixed(3),
            baselineAnkleY: +this.baseline.baselineAnkleY.toFixed(3),
            trunkLength: +this.baseline.trunkLength.toFixed(3),
            initialDropThreshold: +this.currentDropThreshold.toFixed(4),
            targetSec: this.targetDurationSec,
          });
        }
      }
      return;
    }

    // Position-lost runs regardless of usable landmarks.
    const haveValidFrame = !!landmarks && this.hasCoreLandmarks(landmarks);
    this.checkPositionLost(haveValidFrame, now);

    if (!haveValidFrame || !this.baseline || this.broken) return;
    this.processHoldFrame(landmarks!, now);
  }

  finish(): void { this.finished = true; }

  /** Hold-based engines don't have sets; this is a no-op for interface compat. */
  resetForNextSet(): void { /* noop */ }

  // ----------------------------------------------------------
  private processHoldFrame(landmarks: PoseLandmarks, now: number): void {
    const baseline = this.baseline!;
    const la = landmarks[LM.LEFT_ANKLE];
    const ra = landmarks[LM.RIGHT_ANKLE];
    if (!lmVisible(la) || !lmVisible(ra)) return;

    // Outlier clamp on raw per-frame ankle Y delta (BB6 pattern).
    const rawLeftY = clampPerFrameDelta(la.y, this.prevRawLeftAnkleY);
    const rawRightY = clampPerFrameDelta(ra.y, this.prevRawRightAnkleY);
    this.prevRawLeftAnkleY = rawLeftY;
    this.prevRawRightAnkleY = rawRightY;

    // EMA smoothing on per-side ankle Y.
    this.smoothedLeftAnkleY = this.ankleSeeded
      ? EMA_ALPHA_ELEVATION * rawLeftY + (1 - EMA_ALPHA_ELEVATION) * this.smoothedLeftAnkleY
      : rawLeftY;
    this.smoothedRightAnkleY = this.ankleSeeded
      ? EMA_ALPHA_ELEVATION * rawRightY + (1 - EMA_ALPHA_ELEVATION) * this.smoothedRightAnkleY
      : rawRightY;

    // Settling-phase median collection for baseline correction (BB6 pattern).
    // Captured during SETTLING only; applied once we have enough samples.
    if (this.holdState === 'SETTLING' && !this.baselineCorrectionApplied) {
      this.settlingLeftSamples.push(this.smoothedLeftAnkleY);
      this.settlingRightSamples.push(this.smoothedRightAnkleY);
      if (this.settlingLeftSamples.length >= BASELINE_MEDIAN_SAMPLE_COUNT) {
        this.applyBaselineCorrection(baseline);
      }
    }

    // Bilateral max elevation. Y is inverted (smaller Y = heel up), so
    // elevation = baselineAnkleY - smoothedAnkleY.
    const leftElevation = baseline.baselineLeftAnkleY - this.smoothedLeftAnkleY;
    const rightElevation = baseline.baselineRightAnkleY - this.smoothedRightAnkleY;
    const elevation = Math.max(leftElevation, rightElevation);

    // Adaptive drop-threshold recompute (BB6 pattern).
    this.framesSinceCalibration++;
    if (this.framesSinceCalibration > DROP_WARMUP_FRAMES) {
      this.elevationHistory.push(elevation);
      // Cap history at 600 frames (~20 s) to avoid unbounded growth.
      if (this.elevationHistory.length > 600) this.elevationHistory.shift();
      this.framesSinceThresholdRecompute++;
      if (this.framesSinceThresholdRecompute >= 10) {
        this.framesSinceThresholdRecompute = 0;
        const p90 = percentile(this.elevationHistory, DROP_PEAK_PERCENTILE);
        if (p90 > 0) this.currentDropThreshold = p90 * DROP_RATIO;
      }
    }

    const dropThreshold = this.currentDropThreshold;
    const recoveryThreshold = dropThreshold * (1 + DROP_HYSTERESIS_RATIO);

    // State machine.
    switch (this.holdState) {
      case 'SETTLING':
        // Wait for the first true rise — elevation crosses the initial gate.
        if (elevation > dropThreshold) {
          this.holdState = 'HOLDING';
          this.currentHoldingSegmentStartedAt = now;
          debugLog('CALF', 'STATE', 'SETTLING → HOLDING', { elevation: +elevation.toFixed(4), dropThreshold: +dropThreshold.toFixed(4) });
        }
        break;

      case 'HOLDING':
        this.formCounts.totalCount++;
        if (elevation >= dropThreshold) {
          this.formCounts.elevationOKCount++;
          this.dropConfirmFrames = 0;
        } else {
          this.dropConfirmFrames++;
          if (this.dropConfirmFrames >= HEEL_DROP_MIN_FRAMES) {
            // Commit the current HOLDING segment to accumulatedHoldMs.
            this.accumulatedHoldMs += now - this.currentHoldingSegmentStartedAt;
            this.holdState = 'DROPPED';
            this.heelDropCount++;
            this.recoveryConfirmFrames = 0;
            this.maybeEmitWarning('heel-dropped', true, now);
            debugLog('CALF', 'STATE', 'HOLDING → DROPPED', {
              elevation: +elevation.toFixed(4),
              dropThreshold: +dropThreshold.toFixed(4),
              accumulatedSec: +(this.accumulatedHoldMs / 1000).toFixed(1),
              dropCount: this.heelDropCount,
            });
          }
        }
        break;

      case 'DROPPED':
        this.formCounts.totalCount++;
        // Don't count elevation-OK frames during the drop (penalizes form).
        if (elevation > recoveryThreshold) {
          this.recoveryConfirmFrames++;
          if (this.recoveryConfirmFrames >= RECOVERY_MIN_FRAMES) {
            this.holdState = 'HOLDING';
            this.currentHoldingSegmentStartedAt = now;
            this.dropConfirmFrames = 0;
            debugLog('CALF', 'STATE', 'DROPPED → HOLDING', {
              elevation: +elevation.toFixed(4),
              recoveryThreshold: +recoveryThreshold.toFixed(4),
            });
          }
        } else {
          this.recoveryConfirmFrames = 0;
        }
        break;
    }

    this.ankleSeeded = true;

    const metrics: CalfRaiseFrameMetrics = {
      smoothedElevation: elevation,
      leftElevation,
      rightElevation,
      dropThreshold,
      holdState: this.holdState,
    };
    this.callbacks.onFrame?.(metrics);

    // 1 Hz tick.
    if (now - this.lastTickAt >= TICK_INTERVAL_MS) {
      this.lastTickAt = now;
      const liveAccumulatedMs = this.accumulatedHoldMs + (
        this.holdState === 'HOLDING' ? (now - this.currentHoldingSegmentStartedAt) : 0
      );
      const secondsElapsed = Math.floor(liveAccumulatedMs / 1000);
      const completion = getCompletionScore(secondsElapsed, this.targetDurationSec, this.heelDropCount);
      const form = getFormScore(this.formCounts);
      const mqs = Math.round(computeMQS({ smoothness: this.smoothnessPlaceholder, form, completion }));
      this.callbacks.onHoldTick?.({
        secondsElapsed,
        mqs,
        heelDropCount: this.heelDropCount,
      });
    }
  }

  // ----------------------------------------------------------
  private applyBaselineCorrection(baseline: CalfRaiseBaseline): void {
    const leftMedian = median(this.settlingLeftSamples);
    const rightMedian = median(this.settlingRightSamples);
    const cap = baseline.trunkLength * BASELINE_CORRECTION_CAP_FRAC;
    const leftCorrection = clamp(leftMedian - baseline.baselineLeftAnkleY, -cap, cap);
    const rightCorrection = clamp(rightMedian - baseline.baselineRightAnkleY, -cap, cap);
    baseline.baselineLeftAnkleY += leftCorrection;
    baseline.baselineRightAnkleY += rightCorrection;
    baseline.baselineAnkleY = (baseline.baselineLeftAnkleY + baseline.baselineRightAnkleY) / 2;
    this.baselineCorrectionApplied = true;
    debugLog('CALF', 'CALIB', 'baseline median-corrected', {
      leftCorrection: +leftCorrection.toFixed(4),
      rightCorrection: +rightCorrection.toFixed(4),
      newBaselineAnkleY: +baseline.baselineAnkleY.toFixed(4),
    });
  }

  private maybeEmitWarning(type: WarningType, active: boolean, now: number): void {
    if (!active) return;
    const last = this.warningCooldowns[type] ?? 0;
    if (now - last < WARNING_REPEAT_COOLDOWN_MS) return;
    this.warningCooldowns[type] = now;
    debugLog('CALF', 'WARN', type);
    this.callbacks.onPostureWarning?.(type);
  }

  // ----------------------------------------------------------
  // Position-lost detection (Fix N pattern + 10 s hold-broken escalation).
  // ----------------------------------------------------------
  private hasCoreLandmarks(landmarks: PoseLandmarks): boolean {
    return lmVisible(landmarks[LM.LEFT_ANKLE]) && lmVisible(landmarks[LM.RIGHT_ANKLE])
      && lmVisible(landmarks[LM.LEFT_SHOULDER]) && lmVisible(landmarks[LM.RIGHT_SHOULDER])
      && lmVisible(landmarks[LM.LEFT_HIP]) && lmVisible(landmarks[LM.RIGHT_HIP]);
  }

  private checkPositionLost(haveValidFrame: boolean, now: number): void {
    if (haveValidFrame) {
      this.lastValidFrameAt = now;
      return;
    }
    const lostMs = now - this.lastValidFrameAt;
    if (lostMs < POSITION_LOST_TIMEOUT_MS) return;

    // Escalate to hold-broken after sustained position loss.
    if (lostMs >= HOLD_BROKEN_POSITION_LOST_MS && !this.broken) {
      this.broken = true;
      // Commit any in-progress HOLDING segment.
      if (this.holdState === 'HOLDING') {
        this.accumulatedHoldMs += now - this.currentHoldingSegmentStartedAt;
      }
      debugLog('CALF', 'BROKEN', 'Hold ended — sustained position-lost', {
        lostMs: Math.round(lostMs),
        accumulatedSec: +(this.accumulatedHoldMs / 1000).toFixed(1),
      });
      this.maybeEmitWarning('hold-broken', true, now);
      this.callbacks.onHoldBroken?.();
      this.finish();
      return;
    }

    const firstFireAllowed = this.lastPositionLostWarnAt === 0
      || now - this.lastPositionLostWarnAt >= POSITION_LOST_REPEAT_MS;
    if (!firstFireAllowed) return;
    this.lastPositionLostWarnAt = now;
    debugLog('CALF', 'WARN', 'position-lost', { lostMs: Math.round(lostMs) });
    this.callbacks.onPostureWarning?.('position-lost');
  }
}

// ─── Utility helpers (local — keep engine self-contained) ─────────────
function clampPerFrameDelta(raw: number, prev: number): number {
  const delta = raw - prev;
  if (delta > MAX_ANKLE_DELTA_PER_FRAME) return prev + MAX_ANKLE_DELTA_PER_FRAME;
  if (delta < -MAX_ANKLE_DELTA_PER_FRAME) return prev - MAX_ANKLE_DELTA_PER_FRAME;
  return raw;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return sorted[idx];
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}
