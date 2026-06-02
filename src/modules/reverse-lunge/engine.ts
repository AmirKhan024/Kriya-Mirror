/**
 * ReverseLungeEngine — rep-based tracker for front-camera Reverse Lunge.
 *
 * A reverse lunge is mechanically a front lunge done by stepping BACK: the
 * planted (front) leg bends to ~90° while the rear leg drops behind. From the
 * front camera the reliable signal is identical to the forward lunge — the
 * DEEPEST-bending leg's knee flexion — so this reuses the LungeEngine machine
 * (calibration, geometry, scoring, types, and all of lunge's warnings) almost
 * verbatim.
 *
 * The ONE deliberate difference vs LungeEngine: there is NO front-vs-back-leg
 * "bilateral-squat" gap gate. A forward lunge keeps the rear leg straight, so
 * lunge rejects reps where both knees bend equally. A reverse lunge legitimately
 * bends the rear knee (it drops toward the floor), so that gate would falsely
 * reject valid reps. We track only the deepest leg's flexion and count the rep
 * on its descend→bottom→ascend cycle.
 *
 * Warnings (all reused from lunge — no new warning types):
 *   - `valgus`           — front (deepest) knee caves toward midline
 *   - `trunk-forward`    — torso lean > 55°
 *   - `incomplete-lunge` — peak front-leg flex < MIN_REP_DEPTH on rep complete
 *   - `malformed-rep`    — ballistic / too-fast
 *   - `not-moving`       — 5 s idle (Fix I/O/P)
 *   - `position-lost`    — no usable pose frame for ≥ 3 s post-cal (Fix N)
 */
import type { PoseLandmarks } from '@/modules/pose/types';
import type { WarningType } from '@/store/workout';
import { LM, lmVisible, midpoint, kneeFlexionDeg, trunkLeanDeg } from '@/modules/lunge/geometry';
import { LungeCalibration } from '@/modules/lunge/calibration';
import type { LungeBaseline, LungeEngineCallbacks, LungeFrameMetrics, LungeRepState } from '@/modules/lunge/types';
import { computeMQS, getCompletionScore, getFormScore, getSmoothnessScore } from '@/modules/lunge/scoring';
import { debugLog } from '@/lib/debug';

const EMA_ALPHA_KNEE = 0.15;
const DESCEND_START_DEG = 25;
const BOTTOM_STABILITY_FRAMES = 8;
const BOTTOM_STABILITY_DELTA = 3;
const ASCENDING_DELTA_MIN = 3;
const ASCENT_FROM_PEAK_DEG = 10;
const STANDING_THRESHOLD_DEG = 18;
const MIN_REP_DEPTH_DEG = 50;

const VALGUS_THRESHOLD_RATIO = 0.20;
const VALGUS_DEBOUNCE_FRAMES = 10;
const TRUNK_WARN_DEG = 55;

const WARNING_REPEAT_COOLDOWN_MS = 2500;

const NO_MOVEMENT_TIMEOUT_MS = 5000;
const NO_MOVEMENT_VARIANCE_DEG = 2;
const NO_MOVEMENT_REPEAT_MS = 15000;

const POSITION_LOST_TIMEOUT_MS = 3000;
const POSITION_LOST_REPEAT_MS = 10_000;

const MIN_REP_DURATION_MS = 400;
const MAX_HIP_VELOCITY = 1.5;

export class ReverseLungeEngine {
  private callbacks: LungeEngineCallbacks;
  private calibration: LungeCalibration;
  private baseline: LungeBaseline | null = null;

  private repState: LungeRepState = 'STANDING';
  private frontLeg: 'left' | 'right' | null = null;
  private smoothedFlexion = 0;
  private prevSmoothedFlexion = 0;
  private stableBottomCount = 0;
  private maxFlexionThisRep = 0;
  private repHipVelocities: number[] = [];
  private repFormCounts = { kneeOKCount: 0, trunkOKCount: 0, kneeOverToeOKCount: 0, totalCount: 0 };
  private repWarnings: Set<WarningType> = new Set();
  private prevHipY = 0;
  private prevHipTimestamp = 0;

  private repStartedAt = 0;

  // Idle detection
  private standingSince = 0;
  private standingFlexionMin = Infinity;
  private standingFlexionMax = -Infinity;
  private lastNoMovementWarnAt = 0;
  private standingSettledSince = 0;
  private standingBaselineReseeded = false;

  // Position-lost detection
  private lastValidFrameAt = 0;
  private lastPositionLostWarnAt = 0;

  private valgusFrames = 0;

  private warningCooldowns: Partial<Record<WarningType, number>> = {};

  private finished = false;

  constructor(callbacks: LungeEngineCallbacks = {}) {
    this.callbacks = callbacks;
    this.calibration = new LungeCalibration();
  }

  update(landmarks: PoseLandmarks | null, now: number): void {
    if (this.finished) return;

    if (!this.calibration.isConfirmed()) {
      const calUpdate = this.calibration.update(landmarks, now);
      this.callbacks.onCalibrationUpdate?.(calUpdate);
      if (calUpdate.state === 'confirmed') {
        this.baseline = this.calibration.getBaseline();
        this.standingSince = now;
        this.standingFlexionMin = this.smoothedFlexion;
        this.standingFlexionMax = this.smoothedFlexion;
        this.standingSettledSince = 0;
        this.standingBaselineReseeded = false;
        this.lastValidFrameAt = now;
        if (this.baseline) {
          debugLog('REVLUNGE', 'CALIB', 'CONFIRMED', {
            shoulderWidth: +this.baseline.shoulderWidth.toFixed(3),
            feetWidth: +this.baseline.feetWidth.toFixed(3),
          });
        }
      }
      return;
    }

    const haveValidFrame = !!landmarks && this.hasCoreLandmarks(landmarks);
    this.checkPositionLost(haveValidFrame, now);

    if (!haveValidFrame || !this.baseline) return;
    this.processTrackingFrame(landmarks!, now);
  }

  finish(): void { this.finished = true; }

  resetForNextSet(): void {
    this.repState = 'STANDING';
    this.frontLeg = null;
    this.smoothedFlexion = 0;
    this.prevSmoothedFlexion = 0;
    this.stableBottomCount = 0;
    this.resetRepBuffers();
  }

  // ----------------------------------------------------------
  private processTrackingFrame(landmarks: PoseLandmarks, now: number): void {
    const baseline = this.baseline!;

    const lh = landmarks[LM.LEFT_HIP];
    const rh = landmarks[LM.RIGHT_HIP];
    const lk = landmarks[LM.LEFT_KNEE];
    const rk = landmarks[LM.RIGHT_KNEE];
    const la = landmarks[LM.LEFT_ANKLE];
    const ra = landmarks[LM.RIGHT_ANKLE];
    const ls = landmarks[LM.LEFT_SHOULDER];
    const rs = landmarks[LM.RIGHT_SHOULDER];

    const coreOk = lmVisible(lh) && lmVisible(rh) && lmVisible(lk) && lmVisible(rk)
      && lmVisible(la) && lmVisible(ra) && lmVisible(ls) && lmVisible(rs);
    if (!coreOk) return;

    const leftKnee = kneeFlexionDeg(lh, lk, la);
    const rightKnee = kneeFlexionDeg(rh, rk, ra);

    // While STANDING, the deeper-flexing leg becomes the front (planted) leg.
    const frontLegFlex = this.frontLeg === 'left' ? leftKnee
      : this.frontLeg === 'right' ? rightKnee
      : Math.max(leftKnee, rightKnee);

    const rawFlexion = frontLegFlex;
    this.smoothedFlexion = this.smoothedFlexion === 0
      ? rawFlexion
      : EMA_ALPHA_KNEE * rawFlexion + (1 - EMA_ALPHA_KNEE) * this.smoothedFlexion;

    const shoulderMid = midpoint(ls, rs);
    const hipMid = midpoint(lh, rh);
    const trunkDeg = trunkLeanDeg(shoulderMid, hipMid);

    if (this.prevHipTimestamp > 0) {
      const dt = (now - this.prevHipTimestamp) / 1000;
      if (dt > 0) {
        const v = (hipMid.y - this.prevHipY) / dt;
        if (this.repState === 'DESCENDING' || this.repState === 'ASCENDING') {
          this.repHipVelocities.push(v);
        }
      }
    }
    this.prevHipY = hipMid.y;
    this.prevHipTimestamp = now;

    const valgusFront = this.detectFrontKneeValgus(landmarks, baseline);
    const trunkBad = trunkDeg >= TRUNK_WARN_DEG;

    if (this.repState !== 'STANDING') {
      this.repFormCounts.totalCount++;
      if (!valgusFront) this.repFormCounts.kneeOKCount++;
      if (!trunkBad) this.repFormCounts.trunkOKCount++;
      this.repFormCounts.kneeOverToeOKCount++;
    }

    if (valgusFront) this.repWarnings.add('valgus');
    if (trunkBad) this.repWarnings.add('trunk-forward');

    const inActiveRep = this.repState !== 'STANDING';
    if (inActiveRep) {
      this.maybeEmitWarning('valgus', valgusFront, now);
      this.maybeEmitWarning('trunk-forward', trunkBad, now);
    }

    this.checkNoMovement(now);
    this.advanceRepState(now, leftKnee, rightKnee);

    const frameMetrics: LungeFrameMetrics = {
      kneeFlexionDeg: rawFlexion,
      smoothedFlexionDeg: this.smoothedFlexion,
      frontLeg: this.frontLeg,
      repState: this.repState,
      trunkLeanDeg: trunkDeg,
      valgusFront,
      trunkBad,
    };
    this.callbacks.onFrame?.(frameMetrics);

    this.prevSmoothedFlexion = this.smoothedFlexion;
  }

  // ----------------------------------------------------------
  private advanceRepState(now: number, leftKnee: number, rightKnee: number): void {
    switch (this.repState) {
      case 'STANDING':
        if (this.smoothedFlexion > DESCEND_START_DEG) {
          this.frontLeg = leftKnee >= rightKnee ? 'left' : 'right';
          this.repState = 'DESCENDING';
          this.resetRepBuffers();
          this.repStartedAt = now;
          debugLog('REVLUNGE', 'STATE', 'STANDING → DESCENDING', {
            frontLeg: this.frontLeg,
            leftFlex: +leftKnee.toFixed(1),
            rightFlex: +rightKnee.toFixed(1),
          });
        }
        break;

      case 'DESCENDING': {
        this.maxFlexionThisRep = Math.max(this.maxFlexionThisRep, this.smoothedFlexion);
        const delta = Math.abs(this.smoothedFlexion - this.prevSmoothedFlexion);
        if (delta < BOTTOM_STABILITY_DELTA) {
          this.stableBottomCount++;
          if (this.stableBottomCount >= BOTTOM_STABILITY_FRAMES) {
            this.repState = 'AT_BOTTOM';
            debugLog('REVLUNGE', 'STATE', 'DESCENDING → AT_BOTTOM', { peak: +this.maxFlexionThisRep.toFixed(1) });
          }
        } else {
          this.stableBottomCount = 0;
        }
        break;
      }

      case 'AT_BOTTOM': {
        this.maxFlexionThisRep = Math.max(this.maxFlexionThisRep, this.smoothedFlexion);
        const deltaDown = this.smoothedFlexion - this.prevSmoothedFlexion;
        const dropFromPeak = this.maxFlexionThisRep - this.smoothedFlexion;
        if (deltaDown < -ASCENDING_DELTA_MIN || dropFromPeak >= ASCENT_FROM_PEAK_DEG) {
          this.repState = 'ASCENDING';
          debugLog('REVLUNGE', 'STATE', 'AT_BOTTOM → ASCENDING', { peak: +this.maxFlexionThisRep.toFixed(1) });
        }
        break;
      }

      case 'ASCENDING':
        if (this.smoothedFlexion < STANDING_THRESHOLD_DEG) {
          this.completeRep(now);
          this.repState = 'STANDING';
          this.frontLeg = null;
          this.standingSince = now;
          this.standingFlexionMin = Infinity;
          this.standingFlexionMax = -Infinity;
          this.standingSettledSince = 0;
          this.standingBaselineReseeded = false;
        }
        break;
    }
  }

  private validateRepShape(now: number): { ok: true } | { ok: false; reason: string } {
    // No front-vs-back gap gate (a reverse lunge legitimately bends the rear knee).
    if (this.maxFlexionThisRep < MIN_REP_DEPTH_DEG) {
      return { ok: false, reason: 'too-shallow' };
    }
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
    const validation = this.validateRepShape(now);
    if (!validation.ok) {
      const durationMs = this.repStartedAt > 0 ? now - this.repStartedAt : 0;
      debugLog('REVLUNGE', 'REJECT', 'Rep discarded', {
        reason: validation.reason,
        peakFront: +this.maxFlexionThisRep.toFixed(1),
        durationMs: Math.round(durationMs),
        frontLeg: this.frontLeg,
      });
      if (validation.reason === 'too-shallow') {
        this.maybeEmitWarning('incomplete-lunge', true, now);
      } else {
        this.maybeEmitWarning('malformed-rep', true, now);
      }
      this.resetRepBuffers();
      return;
    }

    const smoothness = getSmoothnessScore(this.repHipVelocities);
    const form = getFormScore(this.repFormCounts);
    const completion = getCompletionScore(this.maxFlexionThisRep);
    const mqs = computeMQS({ smoothness, form, completion });

    const repPayload = {
      depthDeg: Math.round(this.maxFlexionThisRep * 10) / 10,
      frontLeg: this.frontLeg ?? 'left',
      smoothness: Math.round(smoothness),
      form: Math.round(form),
      mqs: Math.round(mqs),
      warnings: Array.from(this.repWarnings),
    };
    debugLog('REVLUNGE', 'REP', 'Rep complete', repPayload);
    this.callbacks.onRepComplete?.(repPayload);

    this.resetRepBuffers();
  }

  private checkNoMovement(now: number): void {
    if (this.repState !== 'STANDING') {
      this.standingSince = now;
      this.standingFlexionMin = this.smoothedFlexion;
      this.standingFlexionMax = this.smoothedFlexion;
      this.standingSettledSince = 0;
      this.standingBaselineReseeded = false;
      return;
    }
    if (this.smoothedFlexion < this.standingFlexionMin) this.standingFlexionMin = this.smoothedFlexion;
    if (this.smoothedFlexion > this.standingFlexionMax) this.standingFlexionMax = this.smoothedFlexion;
    if (!this.standingBaselineReseeded) {
      const emaDelta = Math.abs(this.smoothedFlexion - this.prevSmoothedFlexion);
      if (emaDelta < 0.3) {
        if (this.standingSettledSince === 0) this.standingSettledSince = now;
        if (now - this.standingSettledSince >= 500) {
          this.standingFlexionMin = this.smoothedFlexion;
          this.standingFlexionMax = this.smoothedFlexion;
          this.standingSince = now;
          this.standingBaselineReseeded = true;
        }
      } else {
        this.standingSettledSince = 0;
      }
    }
    const idleMs = now - this.standingSince;
    const variance = this.standingFlexionMax - this.standingFlexionMin;
    const firstFireAllowed = this.lastNoMovementWarnAt === 0
      || now - this.lastNoMovementWarnAt >= NO_MOVEMENT_REPEAT_MS;
    if (
      idleMs >= NO_MOVEMENT_TIMEOUT_MS
      && variance < NO_MOVEMENT_VARIANCE_DEG
      && firstFireAllowed
    ) {
      this.lastNoMovementWarnAt = now;
      debugLog('REVLUNGE', 'WARN', 'not-moving', {
        idleMs: Math.round(idleMs),
        flexVariance: +variance.toFixed(2),
      });
      this.callbacks.onPostureWarning?.('not-moving');
      this.standingSince = now;
      this.standingFlexionMin = this.smoothedFlexion;
      this.standingFlexionMax = this.smoothedFlexion;
      this.standingSettledSince = 0;
      this.standingBaselineReseeded = false;
    }
  }

  private resetRepBuffers(): void {
    this.maxFlexionThisRep = 0;
    this.stableBottomCount = 0;
    this.repHipVelocities = [];
    this.repFormCounts = { kneeOKCount: 0, trunkOKCount: 0, kneeOverToeOKCount: 0, totalCount: 0 };
    this.repWarnings = new Set();
    this.repStartedAt = 0;
    this.valgusFrames = 0;
  }

  // ----------------------------------------------------------
  private detectFrontKneeValgus(landmarks: PoseLandmarks, baseline: LungeBaseline): boolean {
    if (this.frontLeg === null) return false;
    const ankle = landmarks[this.frontLeg === 'left' ? LM.LEFT_ANKLE : LM.RIGHT_ANKLE];
    const knee = landmarks[this.frontLeg === 'left' ? LM.LEFT_KNEE : LM.RIGHT_KNEE];
    const midlineX = (baseline.leftKneeX + baseline.rightKneeX) / 2;
    const sign = this.frontLeg === 'left' ? -1 : 1;
    const baselineKneeX = this.frontLeg === 'left' ? baseline.leftKneeX : baseline.rightKneeX;
    const baselineOffset = (baselineKneeX - midlineX) * sign;
    const currentOffset = (knee.x - midlineX) * sign;
    if (baselineOffset <= 0) return false;
    const collapseRatio = 1 - currentOffset / baselineOffset;
    const isValgus = collapseRatio > VALGUS_THRESHOLD_RATIO;

    const ankleOffset = (ankle.x - midlineX) * sign;
    const kneeInsideAnkle = currentOffset < ankleOffset - 0.02;

    if (isValgus || kneeInsideAnkle) {
      this.valgusFrames++;
    } else {
      this.valgusFrames = 0;
    }
    return this.valgusFrames >= VALGUS_DEBOUNCE_FRAMES;
  }

  private maybeEmitWarning(type: WarningType, active: boolean, now: number): void {
    if (!active) return;
    const last = this.warningCooldowns[type] ?? 0;
    if (now - last < WARNING_REPEAT_COOLDOWN_MS) return;
    this.warningCooldowns[type] = now;
    debugLog('REVLUNGE', 'WARN', type);
    this.callbacks.onPostureWarning?.(type);
  }

  // ----------------------------------------------------------
  private hasCoreLandmarks(landmarks: PoseLandmarks): boolean {
    return lmVisible(landmarks[LM.LEFT_HIP]) && lmVisible(landmarks[LM.RIGHT_HIP])
      && lmVisible(landmarks[LM.LEFT_KNEE]) && lmVisible(landmarks[LM.RIGHT_KNEE])
      && lmVisible(landmarks[LM.LEFT_ANKLE]) && lmVisible(landmarks[LM.RIGHT_ANKLE])
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
    debugLog('REVLUNGE', 'WARN', 'position-lost', { lostMs: Math.round(lostMs) });
    this.callbacks.onPostureWarning?.('position-lost');
  }
}
