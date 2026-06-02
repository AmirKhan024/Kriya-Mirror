/**
 * ShrugEngine — bilateral rep tracker for front-camera shrug.
 *
 * Primary signal: shoulder elevation — bilateral mean of left+right shoulder Y.
 * Y inverts in screen space: up = negative Y, so elevation = baseline.shoulderMidY - smoothedShoulderY
 *
 * State machine: STANDING → SHRUGGING → AT_TOP → LOWERING → STANDING
 *
 * Warnings:
 *   torso-swing      — hip midpoint X drifts > 0.03 from baseline for 6+ consecutive frames (STANDING only)
 *   incomplete-shrug — peak shoulder elevation < MIN_SHRUG_HEIGHT
 *   malformed-rep    — ballistic / too-fast
 *   not-moving       — 5 s idle post-calibration
 *   position-lost    — no usable pose frame for ≥ 3 s post-calibration
 *   too-close/far    — calibration distance hints
 */
import type { PoseLandmarks } from '@/modules/pose/types';
import type { WarningType } from '@/store/workout';
import { LM, lmVisible } from './geometry';
import { ShrugCalibration } from './calibration';
import type {
  ShrugBaseline, ShrugEngineCallbacks, ShrugFrameMetrics, ShrugRepState,
} from './types';
import { computeMQS, getCompletionScore, getFormScore, getSmoothnessScore } from './scoring';
import { debugLog } from '@/lib/debug';

const EMA_ALPHA = 0.20;

const SHRUG_ENTER_THRESHOLD = 0.015;
const AT_TOP_THRESHOLD = 0.035;
const AT_TOP_STABILITY_FRAMES = 3;
const RETURN_THRESHOLD = 0.015;
const MIN_SHRUG_HEIGHT = 0.035;

const MIN_REP_DURATION_MS = 300;
const MAX_SHOULDER_VELOCITY = 3.5;

const TORSO_SWING_THRESHOLD = 0.03;
const TORSO_SWING_DEBOUNCE_FRAMES = 6;

const WARNING_REPEAT_COOLDOWN_MS = 2500;

const NO_MOVEMENT_TIMEOUT_MS = 5000;
const NO_MOVEMENT_VARIANCE = 0.008;
const NO_MOVEMENT_REPEAT_MS = 15000;

const POSITION_LOST_TIMEOUT_MS = 3000;
const POSITION_LOST_REPEAT_MS = 10_000;

export class ShrugEngine {
  private callbacks: ShrugEngineCallbacks;
  private calibration: ShrugCalibration;
  private baseline: ShrugBaseline | null = null;

  private repState: ShrugRepState = 'STANDING';
  private smoothedShoulderY = 0;
  private prevSmoothedShoulderY = 0;
  private stableTopCount = 0;
  private maxShrugDeltaThisRep = 0;
  private repShoulderVelocities: number[] = [];
  private repFormCounts = { torsoOKCount: 0, totalCount: 0 };
  private repWarnings: Set<WarningType> = new Set();
  private prevShoulderY = 0;
  private prevShoulderTimestamp = 0;

  private repStartedAt = 0;

  // Idle detection
  private standingSince = 0;
  private standingShoulderYMin = Infinity;
  private standingShoulderYMax = -Infinity;
  private lastNoMovementWarnAt = 0;
  // Post-rep EMA-decay reseed (Fix O)
  private standingSettledSince = 0;
  private standingBaselineReseeded = false;

  // Position-lost detection (Fix N)
  private lastValidFrameAt = 0;
  private lastPositionLostWarnAt = 0;

  private torsoSwingFrames = 0;

  private warningCooldowns: Partial<Record<WarningType, number>> = {};
  private finished = false;

  constructor(callbacks: ShrugEngineCallbacks = {}) {
    this.callbacks = callbacks;
    this.calibration = new ShrugCalibration();
  }

  update(landmarks: PoseLandmarks | null, now: number): void {
    if (this.finished) return;

    if (!this.calibration.isConfirmed()) {
      const calUpdate = this.calibration.update(landmarks, now);
      this.callbacks.onCalibrationUpdate?.(calUpdate);
      if (calUpdate.state === 'confirmed') {
        this.baseline = this.calibration.getBaseline();
        // Fix O + §3.7: initialize idle tracking on cal-confirm
        this.standingSince = now;
        this.standingShoulderYMin = this.smoothedShoulderY;
        this.standingShoulderYMax = this.smoothedShoulderY;
        // Fix N: seed position-lost heartbeat
        this.lastValidFrameAt = now;
        if (this.baseline) {
          debugLog('SHRUG', 'CALIB', 'CONFIRMED', {
            shoulderWidth: +this.baseline.shoulderWidth.toFixed(3),
            shoulderMidY: +this.baseline.shoulderMidY.toFixed(3),
          });
        }
      }
      return;
    }

    // Fix N: position-lost check runs even when landmarks are null
    const haveValidFrame = !!landmarks && this.hasCoreLandmarks(landmarks);
    this.checkPositionLost(haveValidFrame, now);

    if (!haveValidFrame || !this.baseline) return;
    this.processTrackingFrame(landmarks!, now);
  }

  finish(): void { this.finished = true; }

  resetForNextSet(): void {
    this.repState = 'STANDING';
    this.smoothedShoulderY = 0;
    this.prevSmoothedShoulderY = 0;
    this.stableTopCount = 0;
    this.resetRepBuffers();
  }

  // ----------------------------------------------------------
  private processTrackingFrame(landmarks: PoseLandmarks, now: number): void {
    const baseline = this.baseline!;

    const ls = landmarks[LM.LEFT_SHOULDER];
    const rs = landmarks[LM.RIGHT_SHOULDER];
    const lh = landmarks[LM.LEFT_HIP];
    const rh = landmarks[LM.RIGHT_HIP];

    const coreOk = lmVisible(ls) && lmVisible(rs) && lmVisible(lh) && lmVisible(rh);
    if (!coreOk) return;

    const rawShoulderY = (ls.y + rs.y) / 2;

    this.smoothedShoulderY = this.smoothedShoulderY === 0
      ? rawShoulderY
      : EMA_ALPHA * rawShoulderY + (1 - EMA_ALPHA) * this.smoothedShoulderY;

    // Compute elevation delta: positive = shoulders have risen (Y decreased)
    const shrugDelta = baseline.shoulderMidY - this.smoothedShoulderY;

    // Shoulder Y velocity for smoothness scoring
    if (this.prevShoulderTimestamp > 0) {
      const dt = (now - this.prevShoulderTimestamp) / 1000;
      if (dt > 0) {
        const v = (rawShoulderY - this.prevShoulderY) / dt;
        if (this.repState === 'SHRUGGING' || this.repState === 'LOWERING') {
          this.repShoulderVelocities.push(v);
        }
      }
    }
    this.prevShoulderY = rawShoulderY;
    this.prevShoulderTimestamp = now;

    // Torso swing — hip midpoint X oscillation from baseline
    const hipMidX = (lh.x + rh.x) / 2;
    const torsoSwingActive = Math.abs(hipMidX - baseline.hipMidX) > TORSO_SWING_THRESHOLD;
    // Fix A: only count frames in STANDING state
    if (this.repState === 'STANDING') {
      this.torsoSwingFrames = torsoSwingActive ? this.torsoSwingFrames + 1 : 0;
    } else {
      this.torsoSwingFrames = 0;
    }
    const torsoSwingWarn = this.torsoSwingFrames >= TORSO_SWING_DEBOUNCE_FRAMES;

    // Form accumulation (active phases only)
    if (this.repState !== 'STANDING') {
      this.repFormCounts.totalCount++;
      if (!torsoSwingWarn) this.repFormCounts.torsoOKCount++;
    }

    if (torsoSwingWarn) this.repWarnings.add('torso-swing');

    // Fix A: gate torso-swing coaching to STANDING state only
    if (this.repState === 'STANDING') {
      this.maybeEmitWarning('torso-swing', torsoSwingWarn, now);
    }

    this.checkNoMovement(now);
    this.advanceRepState(shrugDelta, now);

    const frameMetrics: ShrugFrameMetrics = {
      shrugDelta: baseline.shoulderMidY - rawShoulderY,
      smoothedShrugDelta: shrugDelta,
      repState: this.repState,
      torsoSwing: torsoSwingWarn,
    };
    this.callbacks.onFrame?.(frameMetrics);

    this.prevSmoothedShoulderY = this.smoothedShoulderY;
  }

  // ----------------------------------------------------------
  private advanceRepState(shrugDelta: number, now: number): void {
    switch (this.repState) {
      case 'STANDING':
        if (shrugDelta > SHRUG_ENTER_THRESHOLD) {
          this.repState = 'SHRUGGING';
          // Fix C: reset buffers FIRST, then set repStartedAt
          this.resetRepBuffers();
          this.repStartedAt = now;
          debugLog('SHRUG', 'STATE', 'STANDING → SHRUGGING', { delta: +shrugDelta.toFixed(3) });
        }
        break;

      case 'SHRUGGING': {
        if (shrugDelta > this.maxShrugDeltaThisRep) this.maxShrugDeltaThisRep = shrugDelta;
        if (shrugDelta > AT_TOP_THRESHOLD) {
          this.stableTopCount++;
          if (this.stableTopCount >= AT_TOP_STABILITY_FRAMES) {
            this.repState = 'AT_TOP';
            debugLog('SHRUG', 'STATE', 'SHRUGGING → AT_TOP', { peak: +this.maxShrugDeltaThisRep.toFixed(3) });
          }
        } else {
          this.stableTopCount = 0;
          // Fallback: if shoulders start descending (delta drops back below enter threshold)
          // without reaching AT_TOP, begin the lowering phase so we can score the rep.
          if (shrugDelta < SHRUG_ENTER_THRESHOLD && this.maxShrugDeltaThisRep > 0) {
            this.repState = 'LOWERING';
            debugLog('SHRUG', 'STATE', 'SHRUGGING → LOWERING (shallow fallback)', { peak: +this.maxShrugDeltaThisRep.toFixed(3) });
          }
        }
        break;
      }

      case 'AT_TOP': {
        if (shrugDelta > this.maxShrugDeltaThisRep) this.maxShrugDeltaThisRep = shrugDelta;
        if (shrugDelta < AT_TOP_THRESHOLD) {
          this.repState = 'LOWERING';
          debugLog('SHRUG', 'STATE', 'AT_TOP → LOWERING', { peak: +this.maxShrugDeltaThisRep.toFixed(3) });
        }
        break;
      }

      case 'LOWERING':
        if (shrugDelta < RETURN_THRESHOLD) {
          this.completeRep(now);
          this.repState = 'STANDING';
          this.standingSince = now;
          this.standingShoulderYMin = Infinity;
          this.standingShoulderYMax = -Infinity;
          this.standingSettledSince = 0;
          this.standingBaselineReseeded = false;
        }
        break;
    }
  }

  private validateRepShape(now: number): { ok: true } | { ok: false; reason: string } {
    if (this.maxShrugDeltaThisRep < MIN_SHRUG_HEIGHT) {
      return { ok: false, reason: 'too-shallow' };
    }
    if (this.repStartedAt > 0 && now - this.repStartedAt < MIN_REP_DURATION_MS) {
      return { ok: false, reason: 'too-fast' };
    }
    if (this.repShoulderVelocities.length > 0) {
      const peakV = Math.max(...this.repShoulderVelocities.map(Math.abs));
      if (peakV > MAX_SHOULDER_VELOCITY) return { ok: false, reason: 'ballistic' };
    }
    return { ok: true };
  }

  private completeRep(now: number): void {
    const validation = this.validateRepShape(now);
    if (!validation.ok) {
      const durationMs = this.repStartedAt > 0 ? now - this.repStartedAt : 0;
      debugLog('SHRUG', 'REJECT', 'Rep discarded', {
        reason: validation.reason,
        peakDelta: +this.maxShrugDeltaThisRep.toFixed(3),
        durationMs: Math.round(durationMs),
      });
      if (validation.reason === 'too-shallow') {
        this.maybeEmitWarning('incomplete-shrug', true, now);
      } else {
        this.maybeEmitWarning('malformed-rep', true, now);
      }
      this.resetRepBuffers();
      return;
    }

    const smoothness = getSmoothnessScore(this.repShoulderVelocities);
    const form = getFormScore(this.repFormCounts);
    const completion = getCompletionScore(this.maxShrugDeltaThisRep);
    const mqs = computeMQS({ smoothness, form, completion });

    const repPayload = {
      depthDeg: Math.round(this.maxShrugDeltaThisRep * 1000) / 1000,
      smoothness: Math.round(smoothness),
      form: Math.round(form),
      mqs: Math.round(mqs),
      warnings: Array.from(this.repWarnings),
    };
    debugLog('SHRUG', 'REP', 'Rep complete', repPayload);
    this.callbacks.onRepComplete?.(repPayload);

    this.resetRepBuffers();
  }

  private checkNoMovement(now: number): void {
    if (this.repState !== 'STANDING') {
      this.standingSince = now;
      this.standingShoulderYMin = this.smoothedShoulderY;
      this.standingShoulderYMax = this.smoothedShoulderY;
      this.standingSettledSince = 0;
      this.standingBaselineReseeded = false;
      return;
    }
    if (this.smoothedShoulderY < this.standingShoulderYMin) this.standingShoulderYMin = this.smoothedShoulderY;
    if (this.smoothedShoulderY > this.standingShoulderYMax) this.standingShoulderYMax = this.smoothedShoulderY;

    // Fix O: reseed EMA once it has settled so post-rep decay tail doesn't
    // permanently inflate max - min and block the not-moving gate.
    if (!this.standingBaselineReseeded) {
      const emaDelta = Math.abs(this.smoothedShoulderY - this.prevSmoothedShoulderY);
      if (emaDelta < 0.001) {
        if (this.standingSettledSince === 0) this.standingSettledSince = now;
        if (now - this.standingSettledSince >= 500) {
          this.standingShoulderYMin = this.smoothedShoulderY;
          this.standingShoulderYMax = this.smoothedShoulderY;
          this.standingSince = now;
          this.standingBaselineReseeded = true;
        }
      } else {
        this.standingSettledSince = 0;
      }
    }

    const idleMs = now - this.standingSince;
    const variance = this.standingShoulderYMax - this.standingShoulderYMin;
    // Fix P: cold-start cooldown — treat initial 0 sentinel as "never fired"
    const firstFireAllowed = this.lastNoMovementWarnAt === 0
      || now - this.lastNoMovementWarnAt >= NO_MOVEMENT_REPEAT_MS;
    if (
      idleMs >= NO_MOVEMENT_TIMEOUT_MS
      && variance < NO_MOVEMENT_VARIANCE
      && firstFireAllowed
    ) {
      this.lastNoMovementWarnAt = now;
      debugLog('SHRUG', 'WARN', 'not-moving', {
        idleMs: Math.round(idleMs),
        yVariance: +variance.toFixed(4),
      });
      this.callbacks.onPostureWarning?.('not-moving');
      this.standingSince = now;
      this.standingShoulderYMin = this.smoothedShoulderY;
      this.standingShoulderYMax = this.smoothedShoulderY;
      this.standingSettledSince = 0;
      this.standingBaselineReseeded = false;
    }
  }

  private resetRepBuffers(): void {
    this.maxShrugDeltaThisRep = 0;
    this.stableTopCount = 0;
    this.repShoulderVelocities = [];
    this.repFormCounts = { torsoOKCount: 0, totalCount: 0 };
    this.repWarnings = new Set();
    this.repStartedAt = 0;
    this.torsoSwingFrames = 0;
  }

  private maybeEmitWarning(type: WarningType, active: boolean, now: number): void {
    if (!active) return;
    const last = this.warningCooldowns[type] ?? 0;
    if (now - last < WARNING_REPEAT_COOLDOWN_MS) return;
    this.warningCooldowns[type] = now;
    debugLog('SHRUG', 'WARN', type);
    this.callbacks.onPostureWarning?.(type);
  }

  // ----------------------------------------------------------
  // Fix N: position-lost detection
  // ----------------------------------------------------------

  private hasCoreLandmarks(landmarks: PoseLandmarks): boolean {
    return lmVisible(landmarks[LM.LEFT_SHOULDER]) && lmVisible(landmarks[LM.RIGHT_SHOULDER])
      && lmVisible(landmarks[LM.LEFT_HIP])      && lmVisible(landmarks[LM.RIGHT_HIP]);
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
    debugLog('SHRUG', 'WARN', 'position-lost', { lostMs: Math.round(lostMs) });
    this.callbacks.onPostureWarning?.('position-lost');
  }
}
