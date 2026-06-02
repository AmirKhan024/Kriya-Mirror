/**
 * HammerCurlEngine — bilateral rep tracker for front-camera hammer curl.
 *
 * Mirrors BicepCurlEngine exactly. Hammer curl uses a neutral (thumbs-up) grip;
 * from a 2D front-camera perspective the kinematic chain (shoulder → elbow → wrist)
 * and the angles produced by elbowFlexionDeg() are identical to the supinated grip.
 *
 * State machine: EXTENDED → CURLING → AT_TOP → LOWERING → EXTENDED
 *
 * Warnings:
 *   torso-swing     — shoulder-mid X drifts > 0.04 from baseline (momentum cheat)
 *   elbow-drift     — elbow X drifts > 0.06 from baseline (elbows leaving ribs)
 *   incomplete-curl — peak avg flex < MIN_REP_DEPTH_DEG (too shallow)
 *   malformed-rep   — ballistic / too-fast / unilateral
 *   not-moving      — 5 s idle post-calibration
 *   position-lost   — no usable pose frame for ≥ 3 s post-calibration
 *   too-close/far   — calibration distance hints
 */
import type { PoseLandmarks } from '@/modules/pose/types';
import type { WarningType } from '@/store/workout';
import { LM, lmVisible, elbowFlexionDeg } from './geometry';
import { HammerCurlCalibration } from './calibration';
import type {
  HammerCurlBaseline, HammerCurlEngineCallbacks, HammerCurlFrameMetrics, HammerCurlRepState,
} from './types';
import { computeMQS, getCompletionScore, getFormScore, getSmoothnessScore } from './scoring';
import { debugLog } from '@/lib/debug';

const EMA_ALPHA_ELBOW = 0.15;
const ASCEND_START_DEG = 25;
const TOP_STABILITY_FRAMES = 8;
const TOP_STABILITY_DELTA = 3;
const DESCENDING_DELTA_MIN = 3;
const DESCENT_FROM_PEAK_DEG = 10;
const EXTENDED_THRESHOLD_DEG = 18;
const MIN_REP_DEPTH_DEG = 85;

const TORSO_SWING_THRESHOLD = 0.04;
const TORSO_SWING_DEBOUNCE_FRAMES = 8;
const ELBOW_DRIFT_THRESHOLD = 0.06;
const ELBOW_DRIFT_DEBOUNCE_FRAMES = 10;

const WARNING_REPEAT_COOLDOWN_MS = 2500;

const NO_MOVEMENT_TIMEOUT_MS = 5000;
const NO_MOVEMENT_VARIANCE_DEG = 2;
const NO_MOVEMENT_REPEAT_MS = 15000;

const POSITION_LOST_TIMEOUT_MS = 3000;
const POSITION_LOST_REPEAT_MS = 10_000;

const MIN_REP_DURATION_MS = 400;
// Physical-test reference: bicep curl wrist peak velocity threshold is 4.0.
// Hammer curl has the same arc length and camera angle, so same threshold applies.
const MAX_WRIST_VELOCITY = 4.0;
const MIN_BILATERAL_SYMMETRY = 0.7;

export class HammerCurlEngine {
  private callbacks: HammerCurlEngineCallbacks;
  private calibration: HammerCurlCalibration;
  private baseline: HammerCurlBaseline | null = null;

  private repState: HammerCurlRepState = 'EXTENDED';
  private smoothedFlexion = 0;
  private prevSmoothedFlexion = 0;
  private stableTopCount = 0;
  private maxFlexionThisRep = 0;
  private repWristVelocities: number[] = [];
  private repFormCounts = { torsoOKCount: 0, elbowOKCount: 0, symmetryOKCount: 0, totalCount: 0 };
  private repWarnings: Set<WarningType> = new Set();
  private prevWristY = 0;
  private prevWristTimestamp = 0;

  private repStartedAt = 0;
  private repPeakLeftElbowDeg = 0;
  private repPeakRightElbowDeg = 0;

  // Idle detection
  private extendedSince = 0;
  private extendedFlexionMin = Infinity;
  private extendedFlexionMax = -Infinity;
  private lastNoMovementWarnAt = 0;
  // Post-rep EMA-decay reseed (Fix O)
  private extendedSettledSince = 0;
  private extendedBaselineReseeded = false;

  // Position-lost detection (Fix N)
  private lastValidFrameAt = 0;
  private lastPositionLostWarnAt = 0;

  private torsoSwingFrames = 0;
  private elbowDriftFrames = 0;

  private warningCooldowns: Partial<Record<WarningType, number>> = {};
  private finished = false;

  constructor(callbacks: HammerCurlEngineCallbacks = {}) {
    this.callbacks = callbacks;
    this.calibration = new HammerCurlCalibration();
  }

  update(landmarks: PoseLandmarks | null, now: number): void {
    if (this.finished) return;

    if (!this.calibration.isConfirmed()) {
      const calUpdate = this.calibration.update(landmarks, now);
      this.callbacks.onCalibrationUpdate?.(calUpdate);
      if (calUpdate.state === 'confirmed') {
        this.baseline = this.calibration.getBaseline();
        // Fix O + §3.7: initialize idle tracking on cal-confirm
        this.extendedSince = now;
        this.extendedFlexionMin = this.smoothedFlexion;
        this.extendedFlexionMax = this.smoothedFlexion;
        // Fix N: seed position-lost heartbeat
        this.lastValidFrameAt = now;
        if (this.baseline) {
          debugLog('HAMMER', 'CALIB', 'CONFIRMED', {
            shoulderWidth: +this.baseline.shoulderWidth.toFixed(3),
            leftElbowX: +this.baseline.leftElbowX.toFixed(3),
            rightElbowX: +this.baseline.rightElbowX.toFixed(3),
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
    this.repState = 'EXTENDED';
    this.smoothedFlexion = 0;
    this.prevSmoothedFlexion = 0;
    this.stableTopCount = 0;
    this.resetRepBuffers();
  }

  // ----------------------------------------------------------
  private processTrackingFrame(landmarks: PoseLandmarks, now: number): void {
    const baseline = this.baseline!;

    const ls = landmarks[LM.LEFT_SHOULDER];
    const rs = landmarks[LM.RIGHT_SHOULDER];
    const le = landmarks[LM.LEFT_ELBOW];
    const re = landmarks[LM.RIGHT_ELBOW];
    const lw = landmarks[LM.LEFT_WRIST];
    const rw = landmarks[LM.RIGHT_WRIST];

    const coreOk = lmVisible(ls) && lmVisible(rs) && lmVisible(le) && lmVisible(re)
      && lmVisible(lw) && lmVisible(rw);
    if (!coreOk) return;

    const leftElbow = elbowFlexionDeg(ls, le, lw);
    const rightElbow = elbowFlexionDeg(rs, re, rw);
    const rawFlexion = (leftElbow + rightElbow) / 2;

    this.smoothedFlexion = this.smoothedFlexion === 0
      ? rawFlexion
      : EMA_ALPHA_ELBOW * rawFlexion + (1 - EMA_ALPHA_ELBOW) * this.smoothedFlexion;

    // Wrist Y velocity for smoothness scoring
    const wristMidY = (lw.y + rw.y) / 2;
    if (this.prevWristTimestamp > 0) {
      const dt = (now - this.prevWristTimestamp) / 1000;
      if (dt > 0) {
        const v = (wristMidY - this.prevWristY) / dt;
        if (this.repState === 'CURLING' || this.repState === 'LOWERING') {
          this.repWristVelocities.push(v);
        }
      }
    }
    this.prevWristY = wristMidY;
    this.prevWristTimestamp = now;

    // Torso swing — shoulder midpoint X oscillation from baseline
    const shoulderMidX = (ls.x + rs.x) / 2;
    const torsoSwingActive = Math.abs(shoulderMidX - baseline.shoulderMidX) > TORSO_SWING_THRESHOLD;
    this.torsoSwingFrames = torsoSwingActive ? this.torsoSwingFrames + 1 : 0;
    const torsoSwingWarn = this.torsoSwingFrames >= TORSO_SWING_DEBOUNCE_FRAMES;

    // Elbow drift — elbow X drifted from baseline
    const leftElbowDrift = Math.abs(le.x - baseline.leftElbowX);
    const rightElbowDrift = Math.abs(re.x - baseline.rightElbowX);
    const elbowDriftActive = Math.max(leftElbowDrift, rightElbowDrift) > ELBOW_DRIFT_THRESHOLD;
    this.elbowDriftFrames = elbowDriftActive ? this.elbowDriftFrames + 1 : 0;
    const elbowDriftWarn = this.elbowDriftFrames >= ELBOW_DRIFT_DEBOUNCE_FRAMES;

    // Bilateral symmetry per-frame
    const flexSum = leftElbow + rightElbow;
    const flexLo = Math.min(leftElbow, rightElbow);
    const flexHi = Math.max(leftElbow, rightElbow);
    const symmetryOK = flexSum < 10 || (flexHi > 0 && flexLo / flexHi >= MIN_BILATERAL_SYMMETRY);

    // Form accumulation (active phases only)
    if (this.repState !== 'EXTENDED') {
      this.repFormCounts.totalCount++;
      if (!torsoSwingWarn) this.repFormCounts.torsoOKCount++;
      if (!elbowDriftWarn) this.repFormCounts.elbowOKCount++;
      if (symmetryOK) this.repFormCounts.symmetryOKCount++;
    }

    if (torsoSwingWarn) this.repWarnings.add('torso-swing');
    if (elbowDriftWarn) this.repWarnings.add('elbow-drift');

    // Fix A: gate form coaching to active rep phase
    if (this.repState !== 'EXTENDED') {
      this.maybeEmitWarning('torso-swing', torsoSwingWarn, now);
      this.maybeEmitWarning('elbow-drift', elbowDriftWarn, now);
    }

    if (this.repState !== 'EXTENDED') {
      if (leftElbow > this.repPeakLeftElbowDeg) this.repPeakLeftElbowDeg = leftElbow;
      if (rightElbow > this.repPeakRightElbowDeg) this.repPeakRightElbowDeg = rightElbow;
    }

    this.checkNoMovement(now);
    this.advanceRepState(now);

    const frameMetrics: HammerCurlFrameMetrics = {
      elbowFlexionDeg: rawFlexion,
      smoothedFlexionDeg: this.smoothedFlexion,
      repState: this.repState,
      leftElbowDeg: leftElbow,
      rightElbowDeg: rightElbow,
      torsoSwing: torsoSwingWarn,
      elbowDrift: elbowDriftWarn,
    };
    this.callbacks.onFrame?.(frameMetrics);

    this.prevSmoothedFlexion = this.smoothedFlexion;
  }

  // ----------------------------------------------------------
  private advanceRepState(now: number): void {
    switch (this.repState) {
      case 'EXTENDED':
        if (this.smoothedFlexion > ASCEND_START_DEG) {
          this.repState = 'CURLING';
          // Fix C: reset buffers FIRST, then set repStartedAt
          this.resetRepBuffers();
          this.repStartedAt = now;
          debugLog('HAMMER', 'STATE', 'EXTENDED → CURLING', { flex: +this.smoothedFlexion.toFixed(1) });
        }
        break;

      case 'CURLING': {
        this.maxFlexionThisRep = Math.max(this.maxFlexionThisRep, this.smoothedFlexion);
        const delta = Math.abs(this.smoothedFlexion - this.prevSmoothedFlexion);
        if (delta < TOP_STABILITY_DELTA) {
          this.stableTopCount++;
          if (this.stableTopCount >= TOP_STABILITY_FRAMES) {
            this.repState = 'AT_TOP';
            debugLog('HAMMER', 'STATE', 'CURLING → AT_TOP', { peak: +this.maxFlexionThisRep.toFixed(1) });
          }
        } else {
          this.stableTopCount = 0;
        }
        break;
      }

      case 'AT_TOP': {
        this.maxFlexionThisRep = Math.max(this.maxFlexionThisRep, this.smoothedFlexion);
        const deltaDown = this.smoothedFlexion - this.prevSmoothedFlexion;
        const dropFromPeak = this.maxFlexionThisRep - this.smoothedFlexion;
        if (deltaDown < -DESCENDING_DELTA_MIN || dropFromPeak >= DESCENT_FROM_PEAK_DEG) {
          this.repState = 'LOWERING';
          debugLog('HAMMER', 'STATE', 'AT_TOP → LOWERING', { peak: +this.maxFlexionThisRep.toFixed(1) });
        }
        break;
      }

      case 'LOWERING':
        if (this.smoothedFlexion < EXTENDED_THRESHOLD_DEG) {
          this.completeRep(now);
          this.repState = 'EXTENDED';
          this.extendedSince = now;
          this.extendedFlexionMin = Infinity;
          this.extendedFlexionMax = -Infinity;
          this.extendedSettledSince = 0;
          this.extendedBaselineReseeded = false;
        }
        break;
    }
  }

  private validateRepShape(now: number): { ok: true } | { ok: false; reason: string } {
    // Fix D: unilateral check BEFORE too-shallow (peakSum > 0 pattern per B1)
    const peakSum = this.repPeakLeftElbowDeg + this.repPeakRightElbowDeg;
    if (peakSum > 0) {
      const lo = Math.min(this.repPeakLeftElbowDeg, this.repPeakRightElbowDeg);
      const hi = Math.max(this.repPeakLeftElbowDeg, this.repPeakRightElbowDeg);
      if (lo / hi < MIN_BILATERAL_SYMMETRY) return { ok: false, reason: 'unilateral' };
    }
    if (this.maxFlexionThisRep < MIN_REP_DEPTH_DEG) {
      return { ok: false, reason: 'too-shallow' };
    }
    if (this.repStartedAt > 0 && now - this.repStartedAt < MIN_REP_DURATION_MS) {
      return { ok: false, reason: 'too-fast' };
    }
    if (this.repWristVelocities.length > 0) {
      const peakV = Math.max(...this.repWristVelocities.map(Math.abs));
      if (peakV > MAX_WRIST_VELOCITY) return { ok: false, reason: 'ballistic' };
    }
    return { ok: true };
  }

  private completeRep(now: number): void {
    const validation = this.validateRepShape(now);
    if (!validation.ok) {
      const durationMs = this.repStartedAt > 0 ? now - this.repStartedAt : 0;
      debugLog('HAMMER', 'REJECT', 'Rep discarded', {
        reason: validation.reason,
        peakAvg: +this.maxFlexionThisRep.toFixed(1),
        durationMs: Math.round(durationMs),
        leftPeak: +this.repPeakLeftElbowDeg.toFixed(1),
        rightPeak: +this.repPeakRightElbowDeg.toFixed(1),
      });
      if (validation.reason === 'too-shallow') {
        this.maybeEmitWarning('incomplete-curl', true, now);
      } else {
        this.maybeEmitWarning('malformed-rep', true, now);
      }
      this.resetRepBuffers();
      return;
    }

    const smoothness = getSmoothnessScore(this.repWristVelocities);
    const form = getFormScore(this.repFormCounts);
    const completion = getCompletionScore(this.maxFlexionThisRep);
    const mqs = computeMQS({ smoothness, form, completion });

    const repPayload = {
      depthDeg: Math.round(this.maxFlexionThisRep * 10) / 10,
      smoothness: Math.round(smoothness),
      form: Math.round(form),
      mqs: Math.round(mqs),
      warnings: Array.from(this.repWarnings),
    };
    debugLog('HAMMER', 'REP', 'Rep complete', repPayload);
    this.callbacks.onRepComplete?.(repPayload);

    this.resetRepBuffers();
  }

  private checkNoMovement(now: number): void {
    if (this.repState !== 'EXTENDED') {
      this.extendedSince = now;
      this.extendedFlexionMin = this.smoothedFlexion;
      this.extendedFlexionMax = this.smoothedFlexion;
      this.extendedSettledSince = 0;
      this.extendedBaselineReseeded = false;
      return;
    }
    if (this.smoothedFlexion < this.extendedFlexionMin) this.extendedFlexionMin = this.smoothedFlexion;
    if (this.smoothedFlexion > this.extendedFlexionMax) this.extendedFlexionMax = this.smoothedFlexion;

    // Fix O: reseed EMA once it has settled so post-rep decay tail doesn't
    // permanently inflate max - min and block the not-moving gate.
    if (!this.extendedBaselineReseeded) {
      const emaDelta = Math.abs(this.smoothedFlexion - this.prevSmoothedFlexion);
      if (emaDelta < 0.3) {
        if (this.extendedSettledSince === 0) this.extendedSettledSince = now;
        if (now - this.extendedSettledSince >= 500) {
          this.extendedFlexionMin = this.smoothedFlexion;
          this.extendedFlexionMax = this.smoothedFlexion;
          this.extendedSince = now;
          this.extendedBaselineReseeded = true;
        }
      } else {
        this.extendedSettledSince = 0;
      }
    }

    const idleMs = now - this.extendedSince;
    const variance = this.extendedFlexionMax - this.extendedFlexionMin;
    // Fix P: cold-start cooldown — treat initial 0 sentinel as "never fired"
    const firstFireAllowed = this.lastNoMovementWarnAt === 0
      || now - this.lastNoMovementWarnAt >= NO_MOVEMENT_REPEAT_MS;
    if (
      idleMs >= NO_MOVEMENT_TIMEOUT_MS
      && variance < NO_MOVEMENT_VARIANCE_DEG
      && firstFireAllowed
    ) {
      this.lastNoMovementWarnAt = now;
      debugLog('HAMMER', 'WARN', 'not-moving', {
        idleMs: Math.round(idleMs),
        flexVariance: +variance.toFixed(2),
      });
      this.callbacks.onPostureWarning?.('not-moving');
      this.extendedSince = now;
      this.extendedFlexionMin = this.smoothedFlexion;
      this.extendedFlexionMax = this.smoothedFlexion;
      this.extendedSettledSince = 0;
      this.extendedBaselineReseeded = false;
    }
  }

  private resetRepBuffers(): void {
    this.maxFlexionThisRep = 0;
    this.stableTopCount = 0;
    this.repWristVelocities = [];
    this.repFormCounts = { torsoOKCount: 0, elbowOKCount: 0, symmetryOKCount: 0, totalCount: 0 };
    this.repWarnings = new Set();
    this.repStartedAt = 0;
    this.repPeakLeftElbowDeg = 0;
    this.repPeakRightElbowDeg = 0;
    this.torsoSwingFrames = 0;
    this.elbowDriftFrames = 0;
  }

  private maybeEmitWarning(type: WarningType, active: boolean, now: number): void {
    if (!active) return;
    const last = this.warningCooldowns[type] ?? 0;
    if (now - last < WARNING_REPEAT_COOLDOWN_MS) return;
    this.warningCooldowns[type] = now;
    debugLog('HAMMER', 'WARN', type);
    this.callbacks.onPostureWarning?.(type);
  }

  // ----------------------------------------------------------
  // Fix N: position-lost detection
  // ----------------------------------------------------------

  private hasCoreLandmarks(landmarks: PoseLandmarks): boolean {
    return lmVisible(landmarks[LM.LEFT_SHOULDER]) && lmVisible(landmarks[LM.RIGHT_SHOULDER])
      && lmVisible(landmarks[LM.LEFT_ELBOW])    && lmVisible(landmarks[LM.RIGHT_ELBOW])
      && lmVisible(landmarks[LM.LEFT_WRIST])    && lmVisible(landmarks[LM.RIGHT_WRIST])
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
    debugLog('HAMMER', 'WARN', 'position-lost', { lostMs: Math.round(lostMs) });
    this.callbacks.onPostureWarning?.('position-lost');
  }
}
