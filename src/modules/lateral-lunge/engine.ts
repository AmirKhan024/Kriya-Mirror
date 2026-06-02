/**
 * LateralLungeEngine — rep-based tracker for front-camera Lateral (Side) Lunge.
 *
 * From feet hip-width, the user steps ONE foot wide to the side and bends THAT
 * knee toward ~90° while the OTHER leg stays straight, sinking the hips toward
 * the bending side; then returns to centre. Reps per side. It is a frontal-plane
 * movement — the working-knee flexion is clearly in-plane — so it reuses the
 * LungeEngine machine (calibration, geometry, scoring, types) the way
 * reverse-lunge does, with three lateral-specific additions adapted from a
 * field-tested Cossack-squat tracker:
 *
 *   1. Straight-leg gate — the planted (non-working) leg must stay near-straight.
 *      Per-frame coaching fires `leg-not-straight`; at rep-complete a too-small
 *      working-vs-planted flex GAP rejects the rep as a squat (`malformed-rep`).
 *      (This is the lateral-lunge analog of forward-lunge's bilateral-squat gate.)
 *   2. Lateral hip-shift confirmation — a real side lunge shifts the hip midpoint
 *      toward the working side; reps with negligible shift (a stationary knee
 *      bend) are rejected (`malformed-rep`).
 *   3. NO heel-grounded check — heel-lift is a sub-noise tiny-ROM signal (the
 *      `calf-raise` failure mode); deliberately omitted.
 *
 * Warnings (ALL reused — no new warning types):
 *   - `valgus`           — working knee caves toward midline
 *   - `trunk-forward`    — torso not upright (front camera captures lateral lean)
 *   - `leg-not-straight` — planted leg bends during the rep
 *   - `incomplete-lunge` — working-leg peak flex < MIN_REP_DEPTH on rep complete
 *   - `malformed-rep`    — ballistic / too-fast / squat-substitution / no-shift
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
// Keep the depth gate lenient: a 2D front camera under-measures lateral-lunge
// depth (the reason the Cossack tracker raised its threshold). Same value as
// lunge / reverse-lunge.
const MIN_REP_DEPTH_DEG = 50;

const TRUNK_WARN_DEG = 55;

// Straight-leg (planted leg) tracking. The non-working knee should stay below
// this flex; beyond it for the debounce window fires `leg-not-straight`.
const STRAIGHT_LEG_MAX_DEG = 30;
const STRAIGHT_LEG_DEBOUNCE_FRAMES = 10;

const WARNING_REPEAT_COOLDOWN_MS = 2500;

const NO_MOVEMENT_TIMEOUT_MS = 5000;
const NO_MOVEMENT_VARIANCE_DEG = 2;
const NO_MOVEMENT_REPEAT_MS = 15000;

const POSITION_LOST_TIMEOUT_MS = 3000;
const POSITION_LOST_REPEAT_MS = 10_000;

const MIN_REP_DURATION_MS = 400;
const MAX_HIP_VELOCITY = 1.5;

// Rep-validity: working-leg peak must exceed planted-leg peak by this (else the
// user squatted instead of lunging). Adapted from lunge's MIN_FRONT_BACK_GAP_DEG.
const MIN_WORKING_PLANTED_GAP_DEG = 20;

// Rep-validity: the hip midpoint must shift toward the working side by at least
// this fraction of (floored) shoulder width during the rep — a genuine lateral
// weight shift, not a stationary knee bend. Lenient on purpose.
const LATERAL_SHIFT_MIN_RATIO = 0.10;
// Fix X — runtime shoulder-width floor so a degenerate baseline can't collapse
// the lateral-shift threshold.
const MIN_SHOULDER_WIDTH_RUNTIME = 0.08;

export class LateralLungeEngine {
  private callbacks: LungeEngineCallbacks;
  private calibration: LungeCalibration;
  private baseline: LungeBaseline | null = null;

  private repState: LungeRepState = 'STANDING';
  private workingLeg: 'left' | 'right' | null = null;
  private smoothedFlexion = 0;
  private prevSmoothedFlexion = 0;
  private stableBottomCount = 0;
  private maxFlexionThisRep = 0;
  private maxPlantedLegFlexThisRep = 0;
  private repHipVelocities: number[] = [];
  private repFormCounts = { kneeOKCount: 0, trunkOKCount: 0, kneeOverToeOKCount: 0, totalCount: 0 };
  private repWarnings: Set<WarningType> = new Set();
  private prevHipY = 0;
  private prevHipTimestamp = 0;

  private repStartedAt = 0;

  // Lateral hip-shift tracking (per rep) — measured vs the calibrated centre
  // (baseline.hipMid.x), toward the working side.
  private maxLateralShiftThisRep = 0;

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

  private legNotStraightFrames = 0;

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
          debugLog('LATERALLUNGE', 'CALIB', 'CONFIRMED', {
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
    this.workingLeg = null;
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

    // While STANDING the deeper-flexing leg becomes the working leg for the rep.
    const workingLegFlex = this.workingLeg === 'left' ? leftKnee
      : this.workingLeg === 'right' ? rightKnee
      : Math.max(leftKnee, rightKnee);
    const plantedLegFlex = this.workingLeg === 'left' ? rightKnee
      : this.workingLeg === 'right' ? leftKnee
      : Math.min(leftKnee, rightKnee);

    const rawFlexion = workingLegFlex;
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

    // Valgus is intentionally NOT tracked for the lateral lunge: a front-camera
    // valgus read during the wide lateral step is geometrically unreliable (the
    // shin angles outward over the wide-planted foot, so the knee reads as
    // "inside the ankle" every rep — a false positive). Coaching relies on the
    // reliable gates: depth, ballistic, straight planted leg, lateral shift, trunk.
    const valgusFront = false;
    const trunkBad = trunkDeg >= TRUNK_WARN_DEG;

    // Straight-leg (planted leg) tracking — debounced like valgus.
    const plantedBent = this.workingLeg !== null && plantedLegFlex > STRAIGHT_LEG_MAX_DEG;
    if (plantedBent) this.legNotStraightFrames++;
    else this.legNotStraightFrames = 0;
    const legNotStraight = this.legNotStraightFrames >= STRAIGHT_LEG_DEBOUNCE_FRAMES;

    const inActiveRep = this.repState !== 'STANDING';

    // Form accumulation (active rep only).
    if (inActiveRep) {
      this.repFormCounts.totalCount++;
      if (!valgusFront) this.repFormCounts.kneeOKCount++;
      if (!trunkBad) this.repFormCounts.trunkOKCount++;
      // Third form slot tracks planted-leg straightness adherence.
      if (!plantedBent) this.repFormCounts.kneeOverToeOKCount++;

      if (plantedLegFlex > this.maxPlantedLegFlexThisRep) this.maxPlantedLegFlexThisRep = plantedLegFlex;

      // Lateral hip-shift accumulation toward the working side, measured from
      // the calibrated centre. A genuine side lunge moves the pelvis toward the
      // bending leg; a stationary knee bend does not.
      const workingAnkleX = this.workingLeg === 'left' ? la.x : ra.x;
      const dirSign = workingAnkleX - baseline.hipMid.x >= 0 ? 1 : -1;
      const shift = (hipMid.x - baseline.hipMid.x) * dirSign;
      if (shift > this.maxLateralShiftThisRep) this.maxLateralShiftThisRep = shift;
    }

    if (trunkBad) this.repWarnings.add('trunk-forward');
    if (legNotStraight) this.repWarnings.add('leg-not-straight');

    // Fix A — gate form coaching to the active rep phase.
    if (inActiveRep) {
      this.maybeEmitWarning('trunk-forward', trunkBad, now);
      this.maybeEmitWarning('leg-not-straight', legNotStraight, now);
    }

    this.checkNoMovement(now);
    this.advanceRepState(now, leftKnee, rightKnee);

    const frameMetrics: LungeFrameMetrics = {
      kneeFlexionDeg: rawFlexion,
      smoothedFlexionDeg: this.smoothedFlexion,
      frontLeg: this.workingLeg,
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
          this.workingLeg = leftKnee >= rightKnee ? 'left' : 'right';
          this.repState = 'DESCENDING';
          // Fix C — reset buffers BEFORE stamping repStartedAt.
          this.resetRepBuffers();
          this.repStartedAt = now;
          debugLog('LATERALLUNGE', 'STATE', 'STANDING → DESCENDING', {
            workingLeg: this.workingLeg,
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
            debugLog('LATERALLUNGE', 'STATE', 'DESCENDING → AT_BOTTOM', { peak: +this.maxFlexionThisRep.toFixed(1) });
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
          debugLog('LATERALLUNGE', 'STATE', 'AT_BOTTOM → ASCENDING', { peak: +this.maxFlexionThisRep.toFixed(1) });
        }
        break;
      }

      case 'ASCENDING':
        if (this.smoothedFlexion < STANDING_THRESHOLD_DEG) {
          this.completeRep(now);
          this.repState = 'STANDING';
          this.workingLeg = null;
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
    // Working-vs-planted gap: the planted leg must stay much straighter than the
    // working leg. If both bent ≈equally the user squatted, not lunged.
    const gap = this.maxFlexionThisRep - this.maxPlantedLegFlexThisRep;
    if (gap < MIN_WORKING_PLANTED_GAP_DEG) {
      return { ok: false, reason: 'squat-substitution' };
    }
    // Lateral hip-shift: a genuine side lunge shifts the pelvis toward the
    // working side. A stationary knee bend shifts almost nothing.
    const refShoulderWidth = Math.max(this.baseline!.shoulderWidth, MIN_SHOULDER_WIDTH_RUNTIME);
    if (this.maxLateralShiftThisRep < LATERAL_SHIFT_MIN_RATIO * refShoulderWidth) {
      return { ok: false, reason: 'no-lateral-shift' };
    }
    return { ok: true };
  }

  private completeRep(now: number): void {
    const validation = this.validateRepShape(now);
    if (!validation.ok) {
      const durationMs = this.repStartedAt > 0 ? now - this.repStartedAt : 0;
      debugLog('LATERALLUNGE', 'REJECT', 'Rep discarded', {
        reason: validation.reason,
        peakWorking: +this.maxFlexionThisRep.toFixed(1),
        peakPlanted: +this.maxPlantedLegFlexThisRep.toFixed(1),
        lateralShift: +this.maxLateralShiftThisRep.toFixed(3),
        durationMs: Math.round(durationMs),
        workingLeg: this.workingLeg,
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
      frontLeg: this.workingLeg ?? 'left',
      smoothness: Math.round(smoothness),
      form: Math.round(form),
      mqs: Math.round(mqs),
      warnings: Array.from(this.repWarnings),
    };
    debugLog('LATERALLUNGE', 'REP', 'Rep complete', repPayload);
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
    // Fix O — re-baseline once the EMA has settled so the post-rep decay tail
    // doesn't permanently inflate `max - min` and suppress `not-moving`.
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
    // Fix P — cold-start cooldown sentinel: allow the first fire when the
    // engine clock is still small.
    const firstFireAllowed = this.lastNoMovementWarnAt === 0
      || now - this.lastNoMovementWarnAt >= NO_MOVEMENT_REPEAT_MS;
    if (
      idleMs >= NO_MOVEMENT_TIMEOUT_MS
      && variance < NO_MOVEMENT_VARIANCE_DEG
      && firstFireAllowed
    ) {
      this.lastNoMovementWarnAt = now;
      debugLog('LATERALLUNGE', 'WARN', 'not-moving', {
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
    this.maxPlantedLegFlexThisRep = 0;
    this.stableBottomCount = 0;
    this.repHipVelocities = [];
    this.repFormCounts = { kneeOKCount: 0, trunkOKCount: 0, kneeOverToeOKCount: 0, totalCount: 0 };
    this.repWarnings = new Set();
    this.repStartedAt = 0;
    this.legNotStraightFrames = 0;
    this.maxLateralShiftThisRep = 0;
  }

  // ----------------------------------------------------------
  private maybeEmitWarning(type: WarningType, active: boolean, now: number): void {
    if (!active) return;
    const last = this.warningCooldowns[type] ?? 0;
    if (now - last < WARNING_REPEAT_COOLDOWN_MS) return;
    this.warningCooldowns[type] = now;
    debugLog('LATERALLUNGE', 'WARN', type);
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
    debugLog('LATERALLUNGE', 'WARN', 'position-lost', { lostMs: Math.round(lostMs) });
    this.callbacks.onPostureWarning?.('position-lost');
  }
}
