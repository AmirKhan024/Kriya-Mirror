/**
 * GluteBridgeEngine — rep-based tracker for side-view Glute Bridge.
 *
 * State machine:
 *   RESTING (hipRiseFraction ≤ ASCEND_START_FRAC) → ASCENDING → AT_TOP →
 *   DESCENDING → RESTING (rep done).
 *
 * Primary metric: hipRiseY = baseline.restingHipY − currentHipMid.y
 *   (positive when hips are raised; y increases downward in normalised coords).
 *
 * All thresholds are expressed as fractions of `kneeAboveHipY` (baseline
 * restingHipY − kneeMid.y at calibration), making them body-size-independent.
 *
 * Warnings:
 *   - 'incomplete-bridge' — peak rise fraction < MIN_REP_RISE_FRAC on rep close
 *   - 'lower-back-arch'   — hip rise > MAX_ARCH_FRAC × kneeAboveHipY
 *   - 'malformed-rep'     — too-fast or ballistic
 *   - 'not-moving'        — 5 s idle in RESTING
 *   - 'position-lost'     — no valid pose for ≥ 3 s post-calibration
 */
import type { PoseLandmarks } from '@/modules/pose/types';
import type { WarningType } from '@/store/workout';
import { LM, lmVisible, midpoint } from './geometry';
import { GluteBridgeCalibration } from './calibration';
import type {
  GluteBridgeBaseline,
  GluteBridgeEngineCallbacks,
  GluteBridgeFrameMetrics,
  GluteBridgeRepState,
} from './types';
import { computeMQS, getCompletionScore, getFormScore, getSmoothnessScore } from './scoring';
import { debugLog } from '@/lib/debug';

const EMA_ALPHA = 0.15;
const ASCEND_START_FRAC = 0.08;       // rise > 8% of kaby → ASCENDING
const TOP_STABLE_DELTA = 0.004;       // abs smoothed delta < this counts as stable
const TOP_STABLE_FRAMES = 5;          // stable frames needed → AT_TOP
const ASCENT_FROM_PEAK_FRAC = 0.10;  // drop from peak > 10% of kaby → DESCENDING
const RETURN_THRESHOLD_FRAC = 0.08;  // rise < 8% of kaby → back to RESTING
const MIN_REP_RISE_FRAC = 0.40;      // peak must be ≥ 40% of kaby for a valid rep
const MAX_ARCH_FRAC = 1.30;          // rise > 130% of kaby → lower-back-arch warning
const MIN_REP_DURATION_MS = 400;
const MAX_HIP_VELOCITY = 1.5;
const WARNING_REPEAT_COOLDOWN_MS = 2500;
const NO_MOVEMENT_TIMEOUT_MS = 5000;
const NO_MOVEMENT_VARIANCE = 0.004;  // normalised Y units
const NO_MOVEMENT_REPEAT_MS = 15000;
const POSITION_LOST_TIMEOUT_MS = 3000;
const POSITION_LOST_REPEAT_MS = 10_000;

export class GluteBridgeEngine {
  private callbacks: GluteBridgeEngineCallbacks;
  private calibration: GluteBridgeCalibration;
  private baseline: GluteBridgeBaseline | null = null;

  private repState: GluteBridgeRepState = 'RESTING';
  private smoothedRiseY = 0;
  private prevSmoothedRiseY = 0;
  private stableTopCount = 0;
  private maxRiseThisRep = 0;
  private repHipVelocities: number[] = [];
  private repFormCounts = { archOKCount: 0, totalCount: 0 };
  private repWarnings: Set<WarningType> = new Set();
  private prevHipY = 0;
  private prevHipTimestamp = 0;
  private repStartedAt = 0;

  // Idle detection
  private restingSince = 0;
  private restingRiseMin = Infinity;
  private restingRiseMax = -Infinity;
  private lastNoMovementWarnAt = 0;
  // EMA-decay reseed: once the smoothed value has settled (< 0.001 delta for
  // 500 ms straight) after a rep, drop the cached min/max and restart from the
  // current value so the post-rep decay tail doesn't permanently inflate variance.
  private restingSettledSince = 0;
  private restingBaselineReseeded = false;

  // Position-lost detection
  private lastValidFrameAt = 0;
  private lastPositionLostWarnAt = 0;

  private warningCooldowns: Partial<Record<WarningType, number>> = {};
  private finished = false;

  constructor(callbacks: GluteBridgeEngineCallbacks = {}) {
    this.callbacks = callbacks;
    this.calibration = new GluteBridgeCalibration();
  }

  update(landmarks: PoseLandmarks | null, now: number): void {
    if (this.finished) return;

    if (!this.calibration.isConfirmed()) {
      const calUpdate = this.calibration.update(landmarks, now);
      this.callbacks.onCalibrationUpdate?.(calUpdate);
      if (calUpdate.state === 'confirmed') {
        this.baseline = this.calibration.getBaseline();
        this.restingSince = now;
        this.restingRiseMin = 0;
        this.restingRiseMax = 0;
        this.restingSettledSince = 0;
        this.restingBaselineReseeded = false;
        this.lastValidFrameAt = now;
        if (this.baseline) {
          debugLog('GLUTE_BRIDGE', 'CALIB', 'CONFIRMED', {
            restingHipY: +this.baseline.restingHipY.toFixed(3),
            kneeAboveHipY: +this.baseline.kneeAboveHipY.toFixed(3),
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
    this.repState = 'RESTING';
    this.smoothedRiseY = 0;
    this.prevSmoothedRiseY = 0;
    this.stableTopCount = 0;
    this.resetRepBuffers();
  }

  // -------------------------------------------------------------------------
  private processTrackingFrame(landmarks: PoseLandmarks, now: number): void {
    const baseline = this.baseline!;

    const ls = landmarks[LM.LEFT_SHOULDER];
    const rs = landmarks[LM.RIGHT_SHOULDER];
    const lh = landmarks[LM.LEFT_HIP];
    const rh = landmarks[LM.RIGHT_HIP];
    const lk = landmarks[LM.LEFT_KNEE];
    const rk = landmarks[LM.RIGHT_KNEE];

    const coreOk = lmVisible(ls) && lmVisible(rs) && lmVisible(lh) && lmVisible(rh)
      && lmVisible(lk) && lmVisible(rk);
    if (!coreOk) return;

    const hipMid = midpoint(lh, rh);
    const rawRiseY = baseline.restingHipY - hipMid.y;

    this.smoothedRiseY = this.smoothedRiseY === 0
      ? rawRiseY
      : EMA_ALPHA * rawRiseY + (1 - EMA_ALPHA) * this.smoothedRiseY;

    const kaby = baseline.kneeAboveHipY;
    const hipRiseFraction = this.smoothedRiseY / kaby;

    // Hip-Y velocity for smoothness scoring.
    if (this.prevHipTimestamp > 0) {
      const dt = (now - this.prevHipTimestamp) / 1000;
      if (dt > 0) {
        const v = (hipMid.y - this.prevHipY) / dt;
        if (this.repState !== 'RESTING') {
          this.repHipVelocities.push(v);
        }
      }
    }
    this.prevHipY = hipMid.y;
    this.prevHipTimestamp = now;

    // Form: track back-arch violations per frame.
    const backArchBad = hipRiseFraction > MAX_ARCH_FRAC;
    if (this.repState !== 'RESTING') {
      this.repFormCounts.totalCount++;
      if (!backArchBad) this.repFormCounts.archOKCount++;
      if (backArchBad) this.repWarnings.add('lower-back-arch');
    }

    // Gate posture warnings to the active rep (Fix A: no coaching between reps).
    if (this.repState !== 'RESTING') {
      this.maybeEmitWarning('lower-back-arch', backArchBad, now);
    }

    this.checkNoMovement(now);
    this.advanceRepState(now);

    const frameMetrics: GluteBridgeFrameMetrics = {
      hipRiseY: rawRiseY,
      smoothedRiseY: this.smoothedRiseY,
      hipRiseFraction,
      repState: this.repState,
      backArchBad,
    };
    this.callbacks.onFrame?.(frameMetrics);

    this.prevSmoothedRiseY = this.smoothedRiseY;
  }

  // -------------------------------------------------------------------------
  private advanceRepState(now: number): void {
    const kaby = this.baseline!.kneeAboveHipY;
    const ascendStart = ASCEND_START_FRAC * kaby;
    const returnThreshold = RETURN_THRESHOLD_FRAC * kaby;
    const ascentFromPeak = ASCENT_FROM_PEAK_FRAC * kaby;

    switch (this.repState) {
      case 'RESTING':
        if (this.smoothedRiseY > ascendStart) {
          this.repState = 'ASCENDING';
          this.resetRepBuffers();
          this.repStartedAt = now;
          debugLog('GLUTE_BRIDGE', 'STATE', 'RESTING → ASCENDING');
        }
        break;

      case 'ASCENDING': {
        this.maxRiseThisRep = Math.max(this.maxRiseThisRep, this.smoothedRiseY);
        const delta = Math.abs(this.smoothedRiseY - this.prevSmoothedRiseY);
        const dropFromPeak = this.maxRiseThisRep - this.smoothedRiseY;

        if (dropFromPeak >= ascentFromPeak) {
          // Fast rep: hip descending before AT_TOP stability was reached.
          this.repState = 'DESCENDING';
          debugLog('GLUTE_BRIDGE', 'STATE', 'ASCENDING → DESCENDING (fast)', {
            peakFrac: +(this.maxRiseThisRep / kaby).toFixed(2),
          });
        } else if (delta < TOP_STABLE_DELTA) {
          this.stableTopCount++;
          if (this.stableTopCount >= TOP_STABLE_FRAMES) {
            this.repState = 'AT_TOP';
            debugLog('GLUTE_BRIDGE', 'STATE', 'ASCENDING → AT_TOP', {
              peakFrac: +(this.maxRiseThisRep / kaby).toFixed(2),
            });
          }
        } else {
          this.stableTopCount = 0;
        }
        break;
      }

      case 'AT_TOP': {
        this.maxRiseThisRep = Math.max(this.maxRiseThisRep, this.smoothedRiseY);
        const dropFromPeak = this.maxRiseThisRep - this.smoothedRiseY;
        if (dropFromPeak >= ascentFromPeak) {
          this.repState = 'DESCENDING';
          debugLog('GLUTE_BRIDGE', 'STATE', 'AT_TOP → DESCENDING');
        }
        break;
      }

      case 'DESCENDING':
        if (this.smoothedRiseY < returnThreshold) {
          this.completeRep(now);
          this.repState = 'RESTING';
          this.restingSince = now;
          this.restingRiseMin = Infinity;
          this.restingRiseMax = -Infinity;
          this.restingSettledSince = 0;
          this.restingBaselineReseeded = false;
        }
        break;
    }
  }

  private validateRepShape(now: number): { ok: true } | { ok: false; reason: string } {
    const kaby = this.baseline!.kneeAboveHipY;
    const peakFraction = this.maxRiseThisRep / kaby;

    if (peakFraction < MIN_REP_RISE_FRAC) return { ok: false, reason: 'too-shallow' };
    if (this.repStartedAt > 0 && now - this.repStartedAt < MIN_REP_DURATION_MS) {
      return { ok: false, reason: 'too-fast' };
    }
    if (this.repHipVelocities.length > 0) {
      const peakV = Math.max(...this.repHipVelocities.map(Math.abs));
      if (peakV > MAX_HIP_VELOCITY) return { ok: false, reason: 'ballistic' };
    }
    return { ok: true };
  }

  private completeRep(now: number): void {
    const kaby = this.baseline!.kneeAboveHipY;
    const validation = this.validateRepShape(now);
    if (!validation.ok) {
      const durationMs = this.repStartedAt > 0 ? now - this.repStartedAt : 0;
      debugLog('GLUTE_BRIDGE', 'REJECT', 'Rep discarded', {
        reason: validation.reason,
        peakFrac: +(this.maxRiseThisRep / kaby).toFixed(2),
        durationMs: Math.round(durationMs),
      });
      if (validation.reason === 'too-shallow') {
        this.maybeEmitWarning('incomplete-bridge', true, now);
      } else {
        this.maybeEmitWarning('malformed-rep', true, now);
      }
      this.resetRepBuffers();
      return;
    }

    const peakRiseFraction = this.maxRiseThisRep / kaby;
    const smoothness = getSmoothnessScore(this.repHipVelocities);
    const form = getFormScore(this.repFormCounts);
    const completion = getCompletionScore(peakRiseFraction);
    const mqs = computeMQS({ smoothness, form, completion });

    const repPayload = {
      depthDeg: Math.round(peakRiseFraction * 1000) / 1000,
      smoothness: Math.round(smoothness),
      form: Math.round(form),
      mqs: Math.round(mqs),
      warnings: Array.from(this.repWarnings),
    };
    debugLog('GLUTE_BRIDGE', 'REP', 'Rep complete', repPayload);
    this.callbacks.onRepComplete?.(repPayload);

    this.resetRepBuffers();
  }

  private checkNoMovement(now: number): void {
    if (this.repState !== 'RESTING') {
      this.restingSince = now;
      this.restingRiseMin = this.smoothedRiseY;
      this.restingRiseMax = this.smoothedRiseY;
      this.restingSettledSince = 0;
      this.restingBaselineReseeded = false;
      return;
    }
    if (this.smoothedRiseY < this.restingRiseMin) this.restingRiseMin = this.smoothedRiseY;
    if (this.smoothedRiseY > this.restingRiseMax) this.restingRiseMax = this.smoothedRiseY;

    // EMA-decay reseed: once per-frame change is < 0.001 for 500 ms, drop the
    // accumulated min/max and reseed so the post-rep decay tail doesn't
    // permanently inflate variance and prevent not-moving from firing.
    if (!this.restingBaselineReseeded) {
      const emaDelta = Math.abs(this.smoothedRiseY - this.prevSmoothedRiseY);
      if (emaDelta < 0.001) {
        if (this.restingSettledSince === 0) this.restingSettledSince = now;
        if (now - this.restingSettledSince >= 500) {
          this.restingRiseMin = this.smoothedRiseY;
          this.restingRiseMax = this.smoothedRiseY;
          this.restingSince = now;
          this.restingBaselineReseeded = true;
        }
      } else {
        this.restingSettledSince = 0;
      }
    }

    const idleMs = now - this.restingSince;
    const variance = this.restingRiseMax - this.restingRiseMin;
    const firstFireAllowed = this.lastNoMovementWarnAt === 0
      || now - this.lastNoMovementWarnAt >= NO_MOVEMENT_REPEAT_MS;
    if (
      idleMs >= NO_MOVEMENT_TIMEOUT_MS
      && variance < NO_MOVEMENT_VARIANCE
      && firstFireAllowed
    ) {
      this.lastNoMovementWarnAt = now;
      debugLog('GLUTE_BRIDGE', 'WARN', 'not-moving', {
        idleMs: Math.round(idleMs),
        riseVariance: +variance.toFixed(4),
      });
      this.callbacks.onPostureWarning?.('not-moving');
      this.restingSince = now;
      this.restingRiseMin = this.smoothedRiseY;
      this.restingRiseMax = this.smoothedRiseY;
      this.restingSettledSince = 0;
      this.restingBaselineReseeded = false;
    }
  }

  private resetRepBuffers(): void {
    this.maxRiseThisRep = 0;
    this.stableTopCount = 0;
    this.repHipVelocities = [];
    this.repFormCounts = { archOKCount: 0, totalCount: 0 };
    this.repWarnings = new Set();
    this.repStartedAt = 0;
  }

  private hasCoreLandmarks(landmarks: PoseLandmarks): boolean {
    return lmVisible(landmarks[LM.LEFT_HIP]) && lmVisible(landmarks[LM.RIGHT_HIP])
      && lmVisible(landmarks[LM.LEFT_KNEE]) && lmVisible(landmarks[LM.RIGHT_KNEE])
      && lmVisible(landmarks[LM.LEFT_SHOULDER]) && lmVisible(landmarks[LM.RIGHT_SHOULDER]);
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
    debugLog('GLUTE_BRIDGE', 'WARN', 'position-lost', { lostMs: Math.round(lostMs) });
    this.callbacks.onPostureWarning?.('position-lost');
  }

  private maybeEmitWarning(type: WarningType, active: boolean, now: number): void {
    if (!active) return;
    const last = this.warningCooldowns[type] ?? 0;
    if (now - last < WARNING_REPEAT_COOLDOWN_MS) return;
    this.warningCooldowns[type] = now;
    debugLog('GLUTE_BRIDGE', 'WARN', type);
    this.callbacks.onPostureWarning?.(type);
  }
}
