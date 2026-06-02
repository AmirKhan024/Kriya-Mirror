/**
 * ClamshellEngine — rep-based tracker for side-view Clamshell (hip abduction).
 *
 * State machine:
 *   CLOSED (abductionFrac < OPEN_START_FRAC) → OPENING → AT_OPEN →
 *   CLOSING → CLOSED (rep done).
 *
 * Primary metric: abductionFrac = (bottomKneeY - topKneeY - kneeGapBaseline) / hipGap
 *   (positive when the top knee has risen above its resting position).
 *
 * Warnings:
 *   - 'incomplete-clamshell' — peak abductionFrac < MIN_REP_OPEN_FRAC at rep close
 *   - 'malformed-rep'        — too-fast (velocity > MAX_KNEE_VELOCITY) or too-short (< MIN_REP_DURATION_MS)
 *   - 'not-moving'           — 5 s idle in CLOSED
 *   - 'position-lost'        — no valid pose for ≥ 3 s post-calibration
 */
import type { PoseLandmarks } from '@/modules/pose/types';
import type { WarningType } from '@/store/workout';
import { LM, lmVisible, kneeAbductionFrac } from './geometry';
import { ClamshellCalibration } from './calibration';
import type {
  ClamshellBaseline,
  ClamshellEngineCallbacks,
  ClamshellFrameMetrics,
  ClamshellRepState,
} from './types';
import { computeMQS, getCompletionScore, getFormScore, getSmoothnessScore } from './scoring';
import { debugLog } from '@/lib/debug';

const EMA_ALPHA = 0.15;
const OPEN_START_FRAC = 0.06;          // abductionFrac > 6% → starts OPENING
const AT_OPEN_STABLE_DELTA = 0.004;    // change < this for stable top
const AT_OPEN_STABLE_FRAMES = 5;
const CLOSING_FROM_PEAK_FRAC = 0.06;  // drop 6% from peak → CLOSING
const CLOSED_THRESHOLD_FRAC = 0.06;   // back below 6% → CLOSED (rep done)

const MIN_REP_OPEN_FRAC = 0.22;       // must open ≥ 22% of hipGap for valid rep
const MIN_REP_DURATION_MS = 400;
const MAX_KNEE_VELOCITY = 1.5;        // normalized knee-spread units/sec

const WARNING_REPEAT_COOLDOWN_MS = 2500;
const NO_MOVEMENT_TIMEOUT_MS = 5000;
const NO_MOVEMENT_VARIANCE = 0.004;   // normalized units (not degrees)
const NO_MOVEMENT_REPEAT_MS = 15000;
const POSITION_LOST_TIMEOUT_MS = 3000;
const POSITION_LOST_REPEAT_MS = 10_000;

export class ClamshellEngine {
  private callbacks: ClamshellEngineCallbacks;
  private calibration: ClamshellCalibration;
  private baseline: ClamshellBaseline | null = null;

  private repState: ClamshellRepState = 'CLOSED';
  private smoothedAbductionFrac = 0;
  private prevSmoothedAbductionFrac = 0;
  private stableOpenCount = 0;
  private maxOpenFracThisRep = 0;
  private repKneeVelocities: number[] = [];
  private repWarnings: Set<WarningType> = new Set();
  private prevFrac = 0;
  private prevFracTimestamp = 0;
  private repStartedAt = 0;

  // Idle detection
  private closedSince = 0;
  private closedFracMin = Infinity;
  private closedFracMax = -Infinity;
  private lastNoMovementWarnAt = 0;
  // EMA-decay reseed: once the smoothed value has settled (< 0.001 delta for
  // 500 ms straight) after a rep, drop the cached min/max and restart from the
  // current value so the post-rep decay tail doesn't permanently inflate variance.
  private closedSettledSince = 0;
  private closedBaselineReseeded = false;

  // Position-lost detection
  private lastValidFrameAt = 0;
  private lastPositionLostWarnAt = 0;

  private warningCooldowns: Partial<Record<WarningType, number>> = {};
  private finished = false;

  constructor(callbacks: ClamshellEngineCallbacks = {}) {
    this.callbacks = callbacks;
    this.calibration = new ClamshellCalibration();
  }

  update(landmarks: PoseLandmarks | null, now: number): void {
    if (this.finished) return;

    if (!this.calibration.isConfirmed()) {
      const calUpdate = this.calibration.update(landmarks, now);
      this.callbacks.onCalibrationUpdate?.(calUpdate);
      if (calUpdate.state === 'confirmed') {
        this.baseline = this.calibration.getBaseline();
        this.closedSince = now;
        this.closedFracMin = 0;
        this.closedFracMax = 0;
        this.closedSettledSince = 0;
        this.closedBaselineReseeded = false;
        this.lastValidFrameAt = now;
        if (this.baseline) {
          debugLog('CLAMSHELL', 'CALIB', 'CONFIRMED', {
            hipGap: +this.baseline.hipGap.toFixed(3),
            kneeGapBaseline: +this.baseline.kneeGapBaseline.toFixed(3),
            bottomSide: this.baseline.bottomSide,
          });
        }
      }
      return;
    }

    // Post-calibration: position-lost runs even when landmarks are null.
    const haveValidFrame = !!landmarks && this.hasCoreLandmarks(landmarks);
    this.checkPositionLost(haveValidFrame, now);

    if (!haveValidFrame || !this.baseline) return;
    this.processTrackingFrame(landmarks!, now);
  }

  finish(): void { this.finished = true; }

  resetForNextSet(): void {
    this.repState = 'CLOSED';
    this.smoothedAbductionFrac = 0;
    this.prevSmoothedAbductionFrac = 0;
    this.stableOpenCount = 0;
    this.resetRepBuffers();
  }

  // -------------------------------------------------------------------------
  private processTrackingFrame(landmarks: PoseLandmarks, now: number): void {
    const baseline = this.baseline!;

    const lh = landmarks[LM.LEFT_HIP];
    const rh = landmarks[LM.RIGHT_HIP];
    const lk = landmarks[LM.LEFT_KNEE];
    const rk = landmarks[LM.RIGHT_KNEE];

    const coreOk = lmVisible(lh) && lmVisible(rh) && lmVisible(lk) && lmVisible(rk);
    if (!coreOk) return;

    const bottomKnee = baseline.bottomSide === 'left' ? lk : rk;
    const topKnee = baseline.bottomSide === 'left' ? rk : lk;

    const rawAbductionFrac = Math.max(
      0,
      kneeAbductionFrac(
        bottomKnee.y,
        topKnee.y,
        baseline.kneeGapBaseline,
        baseline.hipGap,
      ),
    );

    // Initialize EMA on first frame (cold-start sentinel)
    const isFirstFrame = this.prevFracTimestamp === 0;
    this.smoothedAbductionFrac = isFirstFrame
      ? rawAbductionFrac
      : EMA_ALPHA * rawAbductionFrac + (1 - EMA_ALPHA) * this.smoothedAbductionFrac;

    // Knee-spread velocity for smoothness scoring.
    if (this.prevFracTimestamp > 0) {
      const dt = (now - this.prevFracTimestamp) / 1000;
      if (dt > 0) {
        const v = Math.abs(rawAbductionFrac - this.prevFrac) / dt;
        if (this.repState !== 'CLOSED') {
          this.repKneeVelocities.push(v);
        }
      }
    }
    this.prevFrac = rawAbductionFrac;
    this.prevFracTimestamp = now;

    this.checkNoMovement(now);
    this.advanceRepState(now);

    const frameMetrics: ClamshellFrameMetrics = {
      smoothedAbductionFrac: this.smoothedAbductionFrac,
      repState: this.repState,
    };
    this.callbacks.onFrame?.(frameMetrics);

    this.prevSmoothedAbductionFrac = this.smoothedAbductionFrac;
  }

  // -------------------------------------------------------------------------
  private advanceRepState(now: number): void {
    switch (this.repState) {
      case 'CLOSED':
        if (this.smoothedAbductionFrac > OPEN_START_FRAC) {
          this.repState = 'OPENING';
          this.resetRepBuffers();
          this.repStartedAt = now;
          debugLog('CLAMSHELL', 'STATE', 'CLOSED → OPENING');
        }
        break;

      case 'OPENING': {
        this.maxOpenFracThisRep = Math.max(this.maxOpenFracThisRep, this.smoothedAbductionFrac);
        const delta = Math.abs(this.smoothedAbductionFrac - this.prevSmoothedAbductionFrac);
        const dropFromPeak = this.maxOpenFracThisRep - this.smoothedAbductionFrac;

        if (dropFromPeak >= CLOSING_FROM_PEAK_FRAC) {
          // Fast rep: knee descending before AT_OPEN stability was reached.
          this.repState = 'CLOSING';
          debugLog('CLAMSHELL', 'STATE', 'OPENING → CLOSING (fast)', {
            peakFrac: +this.maxOpenFracThisRep.toFixed(3),
          });
        } else if (delta < AT_OPEN_STABLE_DELTA) {
          this.stableOpenCount++;
          if (this.stableOpenCount >= AT_OPEN_STABLE_FRAMES) {
            this.repState = 'AT_OPEN';
            debugLog('CLAMSHELL', 'STATE', 'OPENING → AT_OPEN', {
              peakFrac: +this.maxOpenFracThisRep.toFixed(3),
            });
          }
        } else {
          this.stableOpenCount = 0;
        }
        break;
      }

      case 'AT_OPEN': {
        this.maxOpenFracThisRep = Math.max(this.maxOpenFracThisRep, this.smoothedAbductionFrac);
        const dropFromPeak = this.maxOpenFracThisRep - this.smoothedAbductionFrac;
        if (dropFromPeak >= CLOSING_FROM_PEAK_FRAC) {
          this.repState = 'CLOSING';
          debugLog('CLAMSHELL', 'STATE', 'AT_OPEN → CLOSING');
        }
        break;
      }

      case 'CLOSING':
        if (this.smoothedAbductionFrac < CLOSED_THRESHOLD_FRAC) {
          this.completeRep(now);
          this.repState = 'CLOSED';
          this.closedSince = now;
          this.closedFracMin = Infinity;
          this.closedFracMax = -Infinity;
          this.closedSettledSince = 0;
          this.closedBaselineReseeded = false;
        }
        break;
    }
  }

  private validateRepShape(now: number): { ok: true } | { ok: false; reason: string } {
    if (this.maxOpenFracThisRep < MIN_REP_OPEN_FRAC) return { ok: false, reason: 'too-shallow' };
    if (this.repStartedAt > 0 && now - this.repStartedAt < MIN_REP_DURATION_MS) {
      return { ok: false, reason: 'too-fast' };
    }
    if (this.repKneeVelocities.length > 0) {
      const peakV = Math.max(...this.repKneeVelocities);
      if (peakV > MAX_KNEE_VELOCITY) return { ok: false, reason: 'ballistic' };
    }
    return { ok: true };
  }

  private completeRep(now: number): void {
    const validation = this.validateRepShape(now);
    if (!validation.ok) {
      const durationMs = this.repStartedAt > 0 ? now - this.repStartedAt : 0;
      debugLog('CLAMSHELL', 'REJECT', 'Rep discarded', {
        reason: validation.reason,
        peakFrac: +this.maxOpenFracThisRep.toFixed(3),
        durationMs: Math.round(durationMs),
      });
      if (validation.reason === 'too-shallow') {
        this.repWarnings.add('incomplete-clamshell');
        this.maybeEmitWarning('incomplete-clamshell', true, now);
      } else {
        this.maybeEmitWarning('malformed-rep', true, now);
      }
      this.resetRepBuffers();
      return;
    }

    const smoothness = getSmoothnessScore(this.repKneeVelocities);
    const form = getFormScore();
    const completion = getCompletionScore(this.maxOpenFracThisRep);
    const mqs = computeMQS({ smoothness, completion });

    const repPayload = {
      peakOpenFrac: Math.round(this.maxOpenFracThisRep * 1000) / 1000,
      smoothness: Math.round(smoothness),
      form: Math.round(form),
      mqs: Math.round(mqs),
      warnings: Array.from(this.repWarnings),
    };
    debugLog('CLAMSHELL', 'REP', 'Rep complete', repPayload);
    this.callbacks.onRepComplete?.(repPayload);

    this.resetRepBuffers();
  }

  private checkNoMovement(now: number): void {
    if (this.repState !== 'CLOSED') {
      this.closedSince = now;
      this.closedFracMin = this.smoothedAbductionFrac;
      this.closedFracMax = this.smoothedAbductionFrac;
      this.closedSettledSince = 0;
      this.closedBaselineReseeded = false;
      return;
    }
    if (this.smoothedAbductionFrac < this.closedFracMin) this.closedFracMin = this.smoothedAbductionFrac;
    if (this.smoothedAbductionFrac > this.closedFracMax) this.closedFracMax = this.smoothedAbductionFrac;

    // EMA-decay reseed: once per-frame change is < 0.001 for 500 ms, drop the
    // accumulated min/max and reseed so the post-rep decay tail doesn't
    // permanently inflate variance and prevent not-moving from firing.
    if (!this.closedBaselineReseeded) {
      const emaDelta = Math.abs(this.smoothedAbductionFrac - this.prevSmoothedAbductionFrac);
      if (emaDelta < 0.001) {
        if (this.closedSettledSince === 0) this.closedSettledSince = now;
        if (now - this.closedSettledSince >= 500) {
          this.closedFracMin = this.smoothedAbductionFrac;
          this.closedFracMax = this.smoothedAbductionFrac;
          this.closedSince = now;
          this.closedBaselineReseeded = true;
        }
      } else {
        this.closedSettledSince = 0;
      }
    }

    const idleMs = now - this.closedSince;
    const variance = this.closedFracMax - this.closedFracMin;
    const firstFireAllowed = this.lastNoMovementWarnAt === 0
      || now - this.lastNoMovementWarnAt >= NO_MOVEMENT_REPEAT_MS;
    if (
      idleMs >= NO_MOVEMENT_TIMEOUT_MS
      && variance < NO_MOVEMENT_VARIANCE
      && firstFireAllowed
    ) {
      this.lastNoMovementWarnAt = now;
      debugLog('CLAMSHELL', 'WARN', 'not-moving', {
        idleMs: Math.round(idleMs),
        fracVariance: +variance.toFixed(4),
      });
      this.callbacks.onPostureWarning?.('not-moving');
      this.closedSince = now;
      this.closedFracMin = this.smoothedAbductionFrac;
      this.closedFracMax = this.smoothedAbductionFrac;
      this.closedSettledSince = 0;
      this.closedBaselineReseeded = false;
    }
  }

  private resetRepBuffers(): void {
    this.maxOpenFracThisRep = 0;
    this.stableOpenCount = 0;
    this.repKneeVelocities = [];
    this.repWarnings = new Set();
    this.repStartedAt = 0;
  }

  private hasCoreLandmarks(landmarks: PoseLandmarks): boolean {
    return lmVisible(landmarks[LM.LEFT_HIP]) && lmVisible(landmarks[LM.RIGHT_HIP])
      && lmVisible(landmarks[LM.LEFT_KNEE]) && lmVisible(landmarks[LM.RIGHT_KNEE]);
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
    debugLog('CLAMSHELL', 'WARN', 'position-lost', { lostMs: Math.round(lostMs) });
    this.callbacks.onPostureWarning?.('position-lost');
  }

  private maybeEmitWarning(type: WarningType, active: boolean, now: number): void {
    if (!active) return;
    const last = this.warningCooldowns[type] ?? 0;
    if (now - last < WARNING_REPEAT_COOLDOWN_MS) return;
    this.warningCooldowns[type] = now;
    debugLog('CLAMSHELL', 'WARN', type);
    this.callbacks.onPostureWarning?.(type);
  }
}
