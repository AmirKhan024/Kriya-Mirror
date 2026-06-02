/**
 * NordicCurlEngine — rep-based tracker for side-camera Nordic curls.
 *
 * The user kneels on the floor, feet anchored. They lower their torso forward
 * (an eccentric hamstring exercise) and return. The pivot is at the knee —
 * hips stay locked/extended throughout.
 *
 * Primary signal: trunk lean angle — how far the torso has fallen forward
 * from vertical (0° = upright, 90° = horizontal).
 *
 * State machine:
 *   TALL (trunkLean < 15°)
 *     → DESCENDING (trunkLean > 20°, AND increasing)
 *     → AT_BOTTOM (stable 6+ frames at low Δ)
 *     → ASCENDING (lean drops from peak by 8° or 2°+/frame)
 *     → TALL (trunkLean < 15°, rep complete)
 */
import type { PoseLandmarks } from '@/modules/pose/types';
import type { WarningType } from '@/store/workout';
import { lmVisible, trunkLeanDeg, getSideLandmarks, pickActiveSide } from './geometry';
import { NordicCurlCalibration } from './calibration';
import type {
  NordicCurlBaseline, NordicCurlEngineCallbacks, NordicCurlFrameMetrics, NordicCurlRepState,
} from './types';
import { computeMQS, getCompletionScore, getFormScore, getSmoothnessScore } from './scoring';
import { debugLog } from '@/lib/debug';

const EMA_ALPHA = 0.15;
const DESCENT_START_DEG = 20;          // trunk lean > 20° → DESCENDING
const AT_BOTTOM_STABILITY_FRAMES = 6;
const AT_BOTTOM_STABILITY_DELTA = 3;
const ASCENDING_DELTA_MIN = 2;         // lean drops ≥2° per frame → ASCENDING
const ASCENT_FROM_PEAK_DEG = 8;        // lean drops 8° from peak → also ASCENDING
const TALL_THRESHOLD_DEG = 15;         // lean < 15° → back to TALL

const MIN_REP_DEPTH_DEG = 40;          // must lean ≥ 40° for a valid rep
const MIN_REP_DURATION_MS = 500;       // Nordic curls are slow — 500ms minimum
const MAX_TRUNK_VELOCITY = 2.5;        // normalized trunk-lean units/sec (ballistic gate)

const WARNING_REPEAT_COOLDOWN_MS = 2500;
const NO_MOVEMENT_TIMEOUT_MS = 5000;
const NO_MOVEMENT_VARIANCE_DEG = 2;
const NO_MOVEMENT_REPEAT_MS = 15000;
const POSITION_LOST_TIMEOUT_MS = 3000;
const POSITION_LOST_REPEAT_MS = 10_000;

export class NordicCurlEngine {
  private callbacks: NordicCurlEngineCallbacks;
  private calibration: NordicCurlCalibration;
  private baseline: NordicCurlBaseline | null = null;
  private activeSide: 'left' | 'right' = 'right';

  private repState: NordicCurlRepState = 'TALL';
  private smoothedTrunkLean = 0;
  private prevSmoothedTrunkLean = 0;
  private prevRawLean = 0;
  private stableBottomCount = 0;
  private peakLeanThisRep = 0;
  private repTrunkVelocities: number[] = [];
  private repWarnings: Set<WarningType> = new Set();
  private prevTimestamp = 0;

  private repStartedAt = 0;

  // Idle detection (Fix I + P)
  private tallSince = 0;
  private tallLeanMin = Infinity;
  private tallLeanMax = -Infinity;
  private lastNoMovementWarnAt = 0;

  // EMA reseed (Fix O)
  private tallSettledSince = 0;
  private tallBaselineReseeded = false;

  // Position-lost detection (Fix N)
  private lastValidFrameAt = 0;
  private lastPositionLostWarnAt = 0;

  private warningCooldowns: Partial<Record<WarningType, number>> = {};
  private finished = false;

  constructor(callbacks: NordicCurlEngineCallbacks = {}) {
    this.callbacks = callbacks;
    this.calibration = new NordicCurlCalibration();
  }

  update(landmarks: PoseLandmarks | null, now: number): void {
    if (this.finished) return;

    if (!this.calibration.isConfirmed()) {
      const calUpdate = this.calibration.update(landmarks, now);
      this.callbacks.onCalibrationUpdate?.(calUpdate);
      if (calUpdate.state === 'confirmed') {
        this.baseline = this.calibration.getBaseline();
        if (this.baseline) {
          this.activeSide = this.baseline.activeSide;
        } else {
          // fallback: pick from current landmarks
          if (landmarks) this.activeSide = pickActiveSide(landmarks);
        }
        // Fix I + P: initialize tallSince at cal-confirm (not construction).
        // Without this, tallSince = 0 and idleMs = now - 0 = huge, instantly firing.
        this.tallSince = now;
        this.tallLeanMin = this.smoothedTrunkLean;
        this.tallLeanMax = this.smoothedTrunkLean;
        // Fix N: set lastValidFrameAt so position-lost doesn't fire immediately
        this.lastValidFrameAt = now;
        debugLog('NORDIC-CURL', 'CALIB', 'CONFIRMED', {
          side: this.activeSide,
        });
      }
      return;
    }

    // Fix N: post-cal position-lost check runs regardless of whether the frame is valid
    const haveValidFrame = !!landmarks && this.hasCoreLandmarks(landmarks);
    this.checkPositionLost(haveValidFrame, now);

    if (!landmarks || !this.baseline) return;
    if (!haveValidFrame) return;
    this.processTrackingFrame(landmarks, now);
  }

  finish(): void { this.finished = true; }

  resetForNextSet(): void {
    this.repState = 'TALL';
    this.smoothedTrunkLean = 0;
    this.prevSmoothedTrunkLean = 0;
    this.stableBottomCount = 0;
    this.resetRepBuffers();
  }

  // ----------------------------------------------------------
  private hasCoreLandmarks(landmarks: PoseLandmarks): boolean {
    const { shoulder, hip, knee } = getSideLandmarks(landmarks, this.activeSide);
    return lmVisible(shoulder) && lmVisible(hip) && lmVisible(knee);
  }

  private checkPositionLost(haveValid: boolean, now: number): void {
    if (haveValid) {
      this.lastValidFrameAt = now;
      return;
    }
    if (now - this.lastValidFrameAt < POSITION_LOST_TIMEOUT_MS) return;
    const firstFireAllowed = this.lastPositionLostWarnAt === 0
      || now - this.lastPositionLostWarnAt >= POSITION_LOST_REPEAT_MS;
    if (!firstFireAllowed) return;
    this.lastPositionLostWarnAt = now;
    debugLog('NORDIC-CURL', 'WARN', 'position-lost', { lostMs: Math.round(now - this.lastValidFrameAt) });
    this.callbacks.onPostureWarning?.('position-lost');
  }

  // ----------------------------------------------------------
  private processTrackingFrame(landmarks: PoseLandmarks, now: number): void {
    const { shoulder, hip } = getSideLandmarks(landmarks, this.activeSide);

    const rawLean = trunkLeanDeg(shoulder, hip);

    // Velocity tracking — per-frame change in raw lean degrees.
    // A normal Nordic curl at 30fps descends ~55° over 45 frames ≈ 1.2°/frame (well under 2.5).
    // A ballistic rep covers the same range in a few frames, spiking well above 2.5.
    // Using raw vs prev-raw avoids the EMA gap inflating the velocity reading.
    const leanVelocity = this.prevTimestamp > 0
      ? Math.abs(rawLean - this.prevRawLean)
      : 0;

    if (this.repState === 'DESCENDING' || this.repState === 'ASCENDING') {
      this.repTrunkVelocities.push(leanVelocity);
    }

    this.prevRawLean = rawLean;
    this.prevTimestamp = now;

    // EMA smoothing
    this.smoothedTrunkLean = this.smoothedTrunkLean === 0
      ? rawLean
      : EMA_ALPHA * rawLean + (1 - EMA_ALPHA) * this.smoothedTrunkLean;

    this.checkNoMovement(now);
    this.advanceRepState(now);

    const frameMetrics: NordicCurlFrameMetrics = {
      smoothedTrunkLeanDeg: this.smoothedTrunkLean,
      repState: this.repState,
    };
    this.callbacks.onFrame?.(frameMetrics);

    this.prevSmoothedTrunkLean = this.smoothedTrunkLean;
  }

  // ----------------------------------------------------------
  private advanceRepState(now: number): void {
    switch (this.repState) {
      case 'TALL':
        if (this.smoothedTrunkLean > DESCENT_START_DEG) {
          this.repState = 'DESCENDING';
          // Fix C: reset FIRST, then set repStartedAt
          this.resetRepBuffers();
          this.repStartedAt = now;
          debugLog('NORDIC-CURL', 'STATE', 'TALL → DESCENDING', { lean: +this.smoothedTrunkLean.toFixed(1) });
        }
        break;

      case 'DESCENDING': {
        this.peakLeanThisRep = Math.max(this.peakLeanThisRep, this.smoothedTrunkLean);
        const delta = Math.abs(this.smoothedTrunkLean - this.prevSmoothedTrunkLean);
        if (delta < AT_BOTTOM_STABILITY_DELTA) {
          this.stableBottomCount++;
          if (this.stableBottomCount >= AT_BOTTOM_STABILITY_FRAMES) {
            this.repState = 'AT_BOTTOM';
            debugLog('NORDIC-CURL', 'STATE', 'DESCENDING → AT_BOTTOM', { peak: +this.peakLeanThisRep.toFixed(1) });
          }
        } else {
          this.stableBottomCount = 0;
        }
        break;
      }

      case 'AT_BOTTOM': {
        this.peakLeanThisRep = Math.max(this.peakLeanThisRep, this.smoothedTrunkLean);
        const deltaDown = this.smoothedTrunkLean - this.prevSmoothedTrunkLean;
        const dropFromPeak = this.peakLeanThisRep - this.smoothedTrunkLean;
        if (deltaDown < -ASCENDING_DELTA_MIN || dropFromPeak >= ASCENT_FROM_PEAK_DEG) {
          this.repState = 'ASCENDING';
          debugLog('NORDIC-CURL', 'STATE', 'AT_BOTTOM → ASCENDING', { peak: +this.peakLeanThisRep.toFixed(1) });
        }
        break;
      }

      case 'ASCENDING':
        if (this.smoothedTrunkLean < TALL_THRESHOLD_DEG) {
          this.completeRep(now);
          this.repState = 'TALL';
          this.tallSince = now;
          this.tallLeanMin = Infinity;
          this.tallLeanMax = -Infinity;
          this.tallSettledSince = 0;
          this.tallBaselineReseeded = false;
          debugLog('NORDIC-CURL', 'STATE', 'ASCENDING → TALL (rep complete)');
        }
        break;
    }
  }

  private completeRep(now: number): void {
    const durationMs = this.repStartedAt > 0 ? now - this.repStartedAt : 0;

    // Fix A: malformed-rep and incomplete-nordic-curl only when not TALL
    // (we're in ASCENDING state here, so this is always valid)

    // Too short
    if (durationMs < MIN_REP_DURATION_MS && this.repStartedAt > 0) {
      debugLog('NORDIC-CURL', 'REJECT', 'Rep discarded', { reason: 'too-fast', durationMs: Math.round(durationMs) });
      this.maybeEmitWarning('malformed-rep', true, now);
      this.resetRepBuffers();
      return;
    }

    // Ballistic velocity check
    if (this.repTrunkVelocities.length > 0) {
      const peakV = Math.max(...this.repTrunkVelocities);
      if (peakV > MAX_TRUNK_VELOCITY) {
        debugLog('NORDIC-CURL', 'REJECT', 'Rep discarded', { reason: 'ballistic', peakV: +peakV.toFixed(2) });
        this.maybeEmitWarning('malformed-rep', true, now);
        this.resetRepBuffers();
        return;
      }
    }

    // Depth check — emit warning but still record the rep
    if (this.peakLeanThisRep < MIN_REP_DEPTH_DEG) {
      debugLog('NORDIC-CURL', 'WARN', 'incomplete-nordic-curl', { peakLean: +this.peakLeanThisRep.toFixed(1) });
      this.maybeEmitWarning('incomplete-nordic-curl', true, now);
      // still record the rep (shallow rep is a valid attempt — user gets feedback)
    }

    const smoothness = getSmoothnessScore(this.repTrunkVelocities);
    const form = getFormScore();
    const completion = getCompletionScore(this.peakLeanThisRep);
    const mqs = computeMQS({ smoothness, completion });

    const repPayload = {
      depthDeg: Math.round(this.peakLeanThisRep * 10) / 10,
      smoothness: Math.round(smoothness),
      form: Math.round(form),
      mqs: Math.round(mqs),
      warnings: Array.from(this.repWarnings),
    };
    debugLog('NORDIC-CURL', 'REP', 'Rep complete', repPayload);
    this.callbacks.onRepComplete?.(repPayload);

    this.resetRepBuffers();
  }

  private checkNoMovement(now: number): void {
    if (this.repState !== 'TALL') {
      this.tallSince = now;
      this.tallLeanMin = this.smoothedTrunkLean;
      this.tallLeanMax = this.smoothedTrunkLean;
      this.tallSettledSince = 0;
      this.tallBaselineReseeded = false;
      return;
    }
    if (this.smoothedTrunkLean < this.tallLeanMin) this.tallLeanMin = this.smoothedTrunkLean;
    if (this.smoothedTrunkLean > this.tallLeanMax) this.tallLeanMax = this.smoothedTrunkLean;

    // Fix O: EMA reseed — once the EMA has settled (per-frame change < 0.3° for 500ms),
    // drop the cached min/max and reseed from the current value. This prevents the
    // post-rep EMA decay tail from permanently inflating max - min and blocking not-moving.
    if (!this.tallBaselineReseeded) {
      const emaDelta = Math.abs(this.smoothedTrunkLean - this.prevSmoothedTrunkLean);
      if (emaDelta < 0.3) {
        if (this.tallSettledSince === 0) this.tallSettledSince = now;
        if (now - this.tallSettledSince >= 500) {
          this.tallLeanMin = this.smoothedTrunkLean;
          this.tallLeanMax = this.smoothedTrunkLean;
          this.tallSince = now;
          this.tallBaselineReseeded = true;
        }
      } else {
        this.tallSettledSince = 0;
      }
    }

    const idleMs = now - this.tallSince;
    const variance = this.tallLeanMax - this.tallLeanMin;
    // Fix P: cold-start sentinel — treat lastNoMovementWarnAt === 0 as "never fired"
    const firstFireAllowed = this.lastNoMovementWarnAt === 0
      || now - this.lastNoMovementWarnAt >= NO_MOVEMENT_REPEAT_MS;
    if (
      idleMs >= NO_MOVEMENT_TIMEOUT_MS
      && variance < NO_MOVEMENT_VARIANCE_DEG
      && firstFireAllowed
    ) {
      this.lastNoMovementWarnAt = now;
      debugLog('NORDIC-CURL', 'WARN', 'not-moving', {
        idleMs: Math.round(idleMs),
        leanVariance: +variance.toFixed(2),
      });
      this.callbacks.onPostureWarning?.('not-moving');
      this.tallSince = now;
      this.tallLeanMin = this.smoothedTrunkLean;
      this.tallLeanMax = this.smoothedTrunkLean;
    }
  }

  private resetRepBuffers(): void {
    this.peakLeanThisRep = 0;
    this.stableBottomCount = 0;
    this.repTrunkVelocities = [];
    this.repWarnings = new Set();
    this.repStartedAt = 0;
  }

  private maybeEmitWarning(type: WarningType, active: boolean, now: number): void {
    if (!active) return;
    const last = this.warningCooldowns[type] ?? 0;
    if (now - last < WARNING_REPEAT_COOLDOWN_MS) return;
    this.warningCooldowns[type] = now;
    debugLog('NORDIC-CURL', 'WARN', type);
    this.callbacks.onPostureWarning?.(type);
  }
}
