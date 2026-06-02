/**
 * GobletSquatEngine — pure-logic goblet squat tracker.
 *
 * Derives from SquatEngine with three additions:
 *   1. elbowSpreadRatio computation per frame (elbowWidth / shoulderWidth)
 *   2. 'goblet-elbows-collapsing' warning when elbows cave inward during active rep
 *   3. 'incomplete-goblet-squat' replaces 'incomplete-squat' for depth validation
 *
 * All other logic (state machine, posture gates, scoring, Fix A–R) is
 * identical to SquatEngine.
 */
import type { PoseLandmarks } from '@/modules/pose/types';
import type { WarningType } from '@/store/workout';
import {
  LM, lmVisible, midpoint, kneeFlexionDeg, trunkLeanDeg,
} from './geometry';
import { GobletSquatCalibration } from './calibration';
import type {
  CalibrationBaseline, CalibrationUpdate, GobletSquatRepState, GobletSquatEngineCallbacks, GobletSquatFrameMetrics,
} from './types';
import { computeMQS, getCompletionScore, getFormScore, getSmoothnessScore } from './scoring';
import { debugLog } from '@/lib/debug';

const EMA_ALPHA_KNEE = 0.15;
const DESCEND_START = 25;
const BOTTOM_STABILITY_FRAMES = 8;
const BOTTOM_STABILITY_DELTA = 3;
const ASCENDING_DELTA_MIN = 3;
const ASCENT_FROM_PEAK_DEG = 10;
const STANDING_THRESHOLD = 18;
const MIN_REP_DEPTH = 45;

const HEEL_LIFT_THRESHOLD = 0.032;
const HEEL_LIFT_DEBOUNCE_FRAMES = 12;
const VALGUS_THRESHOLD_RATIO = 0.15;
const VALGUS_DEBOUNCE_FRAMES = 10;
const TRUNK_WARN_DEG = 55;

const FACING_WIDTH_MIN_RATIO = 0.5;
const BODY_HEIGHT_MIN_RATIO = 0.28;
const FEET_WIDTH_MIN_RATIO = 0.7;
const FACING_WARN_FRAMES = 20;
const DISTANCE_WARN_FRAMES = 20;

const WARNING_REPEAT_COOLDOWN_MS = 2500;

const NO_MOVEMENT_TIMEOUT_MS = 5000;
const NO_MOVEMENT_VARIANCE_DEG = 2;
const NO_MOVEMENT_REPEAT_MS = 15000;

const MIN_REP_DURATION_MS = 300;
const MAX_HIP_VELOCITY = 1.5;
const MIN_BILATERAL_SYMMETRY = 0.7;

const MAX_VALGUS_FRAME_RATIO = 0.25;

// 2026-05-25 round 6: position-lost detection
const POSITION_LOST_TIMEOUT_MS = 3000;
const POSITION_LOST_REPEAT_MS = 10_000;

// Elbow spread gate — goblet grip monitoring
const ELBOW_COLLAPSE_RATIO = 0.70;     // elbowWidth/shoulderWidth < 0.70 → elbows collapsing
const ELBOW_DEBOUNCE_FRAMES = 8;       // sustained collapse needed to fire (brief = noise)

export class GobletSquatEngine {
  private callbacks: GobletSquatEngineCallbacks;
  private calibration: GobletSquatCalibration;
  private baseline: CalibrationBaseline | null = null;

  private repState: GobletSquatRepState = 'STANDING';
  private smoothedFlexion = 0;
  private prevSmoothedFlexion = 0;
  private stableBottomCount = 0;
  private maxFlexionThisRep = 0;
  private repHipVelocities: number[] = [];
  private repFormCounts = { heelOKCount: 0, kneeOKCount: 0, trunkOKCount: 0, totalCount: 0 };
  private repWarnings: Set<WarningType> = new Set();
  private prevHipY = 0;
  private prevHipTimestamp = 0;

  // Per-rep wrong-movement tracking
  private repStartedAt = 0;
  private repPeakLeftKneeDeg = 0;
  private repPeakRightKneeDeg = 0;

  private currentRepValgusFramesRaw = 0;
  private currentRepHeelLiftFramesRaw = 0;

  // No-movement detection
  private standingSince = 0;
  private standingFlexionMin = Infinity;
  private standingFlexionMax = -Infinity;
  private lastNoMovementWarnAt = 0;
  // Fix O: post-rep EMA-decay reseed
  private standingSettledSince = 0;
  private standingBaselineReseeded = false;

  // Fix N: position-lost detection
  private lastValidFrameAt = 0;
  private lastPositionLostWarnAt = 0;

  // Goblet-specific: elbow collapse counter
  private elbowCollapseFrames = 0;

  private heelLiftFrames = 0;
  private valgusFrames = 0;
  private facingBadFrames = 0;
  private distanceBadFrames = 0;
  private feetNarrowFrames = 0;

  private warningCooldowns: Partial<Record<WarningType, number>> = {};

  private finished = false;

  constructor(callbacks: GobletSquatEngineCallbacks = {}) {
    this.callbacks = callbacks;
    this.calibration = new GobletSquatCalibration();
  }

  /** Feed one pose frame. Engine internally routes to calibration vs tracking. */
  update(landmarks: PoseLandmarks | null, now: number): void {
    if (this.finished) return;

    if (!this.calibration.isConfirmed()) {
      const calUpdate = this.calibration.update(landmarks, now);
      this.callbacks.onCalibrationUpdate?.(calUpdate);
      if (calUpdate.state === 'confirmed' && calUpdate.baseline) {
        this.baseline = calUpdate.baseline;
        // Fix A: initialize standingSince at calibration confirm
        this.standingSince = now;
        this.standingFlexionMin = this.smoothedFlexion;
        this.standingFlexionMax = this.smoothedFlexion;
        this.standingSettledSince = 0;
        this.standingBaselineReseeded = false;
        // Fix N: seed position-lost heartbeat
        this.lastValidFrameAt = now;
        debugLog('GOBLET', 'CALIB', 'CONFIRMED', {
          feetVsShoulderRatio: +calUpdate.baseline.feetVsShoulderRatio.toFixed(2),
          torsoHeight: +calUpdate.baseline.torsoHeight.toFixed(3),
        });
      }
      return;
    }

    // Fix N: post-cal position-lost check runs regardless of whether the current
    // frame has usable landmarks
    const haveValidFrame = !!landmarks && this.hasCoreLandmarks(landmarks);
    this.checkPositionLost(haveValidFrame, now);

    if (!haveValidFrame || !this.baseline) return;
    this.processTrackingFrame(landmarks!, now);
  }

  /** Force-complete the engine (e.g., user stopped early). */
  finish(): void {
    this.finished = true;
  }

  /** Reset the rep state machine for the next set. Keeps calibration. */
  resetForNextSet(): void {
    this.repState = 'STANDING';
    this.smoothedFlexion = 0;
    this.prevSmoothedFlexion = 0;
    this.stableBottomCount = 0;
    this.elbowCollapseFrames = 0;
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

    // Knee flexion (avg of L + R)
    const leftKnee = kneeFlexionDeg(lh, lk, la);
    const rightKnee = kneeFlexionDeg(rh, rk, ra);
    const rawFlexion = (leftKnee + rightKnee) / 2;
    this.smoothedFlexion = this.smoothedFlexion === 0
      ? rawFlexion
      : EMA_ALPHA_KNEE * rawFlexion + (1 - EMA_ALPHA_KNEE) * this.smoothedFlexion;

    // Trunk lean
    const shoulderMid = midpoint(ls, rs);
    const hipMid = midpoint(lh, rh);
    const trunkDeg = trunkLeanDeg(shoulderMid, hipMid);

    // Hip Y velocity (for smoothness)
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

    // Elbow spread ratio — goblet-specific
    const leftElbowX = landmarks[LM.LEFT_ELBOW].x;
    const rightElbowX = landmarks[LM.RIGHT_ELBOW].x;
    const leftShoulderX = ls.x;
    const rightShoulderX = rs.x;
    const elbowWidth = Math.abs(rightElbowX - leftElbowX);
    const shoulderWidth = Math.abs(rightShoulderX - leftShoulderX);
    const elbowSpreadRatio = shoulderWidth > 0.01 ? elbowWidth / shoulderWidth : 1.0;

    // Posture gates (each tracks its own debounce)
    const heelLifted = this.detectHeelLift(landmarks, baseline);
    const kneesValgus = this.detectValgus(landmarks, baseline);
    const trunkBad = trunkDeg >= TRUNK_WARN_DEG;
    const feetTooNarrow = this.detectFeetNarrow(landmarks, baseline);
    const notFacing = this.detectNotFacing(landmarks, baseline);
    const { tooClose, tooFar } = this.detectDistance(landmarks, baseline);

    // Raw per-frame valgus / heel-lift checks (debounce-free)
    const lkRaw = landmarks[LM.LEFT_KNEE];
    const rkRaw = landmarks[LM.RIGHT_KNEE];
    const kneeWidthNow = Math.abs(lkRaw.x - rkRaw.x);
    const baselineKneeWidth = Math.abs(baseline.leftKneeX - baseline.rightKneeX);
    const rawValgus = baselineKneeWidth > 0
      && (1 - kneeWidthNow / baselineKneeWidth) > VALGUS_THRESHOLD_RATIO;
    const laRaw = landmarks[LM.LEFT_ANKLE];
    const raRaw = landmarks[LM.RIGHT_ANKLE];
    const currentAnkleY = (laRaw.y + raRaw.y) / 2;
    const rawHeelLift = (baseline.ankleY - currentAnkleY) > HEEL_LIFT_THRESHOLD;

    // Form accumulation during DESCENDING/AT_BOTTOM/ASCENDING (active squat phase)
    if (this.repState !== 'STANDING') {
      this.repFormCounts.totalCount++;
      if (!heelLifted) this.repFormCounts.heelOKCount++;
      if (!kneesValgus) this.repFormCounts.kneeOKCount++;
      if (!trunkBad) this.repFormCounts.trunkOKCount++;
      if (rawValgus) this.currentRepValgusFramesRaw++;
      if (rawHeelLift) this.currentRepHeelLiftFramesRaw++;
    }

    // Track warnings that hit during this rep
    if (heelLifted) this.repWarnings.add('heel-lift');
    if (kneesValgus) this.repWarnings.add('valgus');
    if (trunkBad) this.repWarnings.add('trunk-forward');
    if (feetTooNarrow) this.repWarnings.add('feet-narrow');
    if (notFacing) this.repWarnings.add('not-facing');
    if (tooClose) this.repWarnings.add('too-close');
    if (tooFar) this.repWarnings.add('too-far');

    // Gate posture-form warnings to the active rep phase (Fix A)
    const inActiveRep = this.repState !== 'STANDING';
    if (inActiveRep) {
      this.maybeEmitWarning('heel-lift', heelLifted, now);
      this.maybeEmitWarning('valgus', kneesValgus, now);
      this.maybeEmitWarning('trunk-forward', trunkBad, now);
      this.maybeEmitWarning('feet-narrow', feetTooNarrow, now);

      // Goblet-specific: elbow collapse detection (gated to active rep)
      if (elbowSpreadRatio < ELBOW_COLLAPSE_RATIO) {
        this.elbowCollapseFrames += 1;
        if (this.elbowCollapseFrames >= ELBOW_DEBOUNCE_FRAMES) {
          this.maybeEmitWarning('goblet-elbows-collapsing' as WarningType, true, now);
          this.elbowCollapseFrames = 0; // reset after fire to prevent spam
        }
      } else {
        this.elbowCollapseFrames = 0;
      }
    } else {
      // Not in active rep — reset elbow collapse counter
      this.elbowCollapseFrames = 0;
    }

    this.maybeEmitWarning('not-facing', notFacing, now);
    this.maybeEmitWarning('too-close', tooClose, now);
    this.maybeEmitWarning('too-far', tooFar, now);

    // Per-rep bilateral knee peak (for symmetry sanity check)
    if (this.repState !== 'STANDING') {
      if (leftKnee > this.repPeakLeftKneeDeg) this.repPeakLeftKneeDeg = leftKnee;
      if (rightKnee > this.repPeakRightKneeDeg) this.repPeakRightKneeDeg = rightKnee;
    }

    // No-movement detection
    this.checkNoMovement(now);

    // State machine
    this.advanceRepState(now);

    // Per-frame snapshot for HUD
    const frameMetrics: GobletSquatFrameMetrics = {
      smoothedFlexionDeg: this.smoothedFlexion,
      elbowSpreadRatio,
      repState: this.repState,
    };
    this.callbacks.onFrame?.(frameMetrics);

    this.prevSmoothedFlexion = this.smoothedFlexion;
  }

  // ----------------------------------------------------------
  private advanceRepState(now: number): void {
    switch (this.repState) {
      case 'STANDING':
        if (this.smoothedFlexion > DESCEND_START) {
          this.repState = 'DESCENDING';
          this.resetRepBuffers();
          this.repStartedAt = now;
          debugLog('GOBLET', 'STATE', 'STANDING → DESCENDING', { flex: +this.smoothedFlexion.toFixed(1) });
        }
        break;

      case 'DESCENDING': {
        this.maxFlexionThisRep = Math.max(this.maxFlexionThisRep, this.smoothedFlexion);
        const delta = Math.abs(this.smoothedFlexion - this.prevSmoothedFlexion);
        if (delta < BOTTOM_STABILITY_DELTA) {
          this.stableBottomCount++;
          if (this.stableBottomCount >= BOTTOM_STABILITY_FRAMES) {
            this.repState = 'AT_BOTTOM';
            debugLog('GOBLET', 'STATE', 'DESCENDING → AT_BOTTOM', { peak: +this.maxFlexionThisRep.toFixed(1) });
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
          debugLog('GOBLET', 'STATE', 'AT_BOTTOM → ASCENDING', { peak: +this.maxFlexionThisRep.toFixed(1) });
        }
        break;
      }

      case 'ASCENDING':
        if (this.smoothedFlexion < STANDING_THRESHOLD) {
          this.completeRep(now);
          this.repState = 'STANDING';
          // Reset elbow collapse frames on ASCENDING → STANDING transition
          this.elbowCollapseFrames = 0;
          this.standingSince = now;
          this.standingFlexionMin = Infinity;
          this.standingFlexionMax = -Infinity;
          this.standingSettledSince = 0;
          this.standingBaselineReseeded = false;
        }
        break;
    }
  }

  /** Per-rep validation against wrong-movement sanity gates. */
  private validateRepShape(now: number): { ok: true } | { ok: false; reason: string } {
    const peakSum = this.repPeakLeftKneeDeg + this.repPeakRightKneeDeg;
    if (peakSum > 0) {
      const lo = Math.min(this.repPeakLeftKneeDeg, this.repPeakRightKneeDeg);
      const hi = Math.max(this.repPeakLeftKneeDeg, this.repPeakRightKneeDeg);
      if (lo / hi < MIN_BILATERAL_SYMMETRY) return { ok: false, reason: 'unilateral' };
    }
    // Goblet: incomplete check uses 'incomplete-goblet-squat'
    if (this.maxFlexionThisRep < MIN_REP_DEPTH) {
      this.callbacks.onPostureWarning?.('incomplete-goblet-squat' as WarningType);
      return { ok: false, reason: 'incomplete' };
    }
    if (this.repStartedAt > 0 && now - this.repStartedAt < MIN_REP_DURATION_MS) {
      return { ok: false, reason: 'too-fast' };
    }
    if (this.repHipVelocities.length > 0) {
      const peakV = Math.max(...this.repHipVelocities.map(Math.abs));
      if (peakV > MAX_HIP_VELOCITY) return { ok: false, reason: 'ballistic' };
    }
    const activeFrames = this.repFormCounts.totalCount;
    if (activeFrames > 0 && this.currentRepValgusFramesRaw / activeFrames > MAX_VALGUS_FRAME_RATIO) {
      return { ok: false, reason: 'collapsed-knees' };
    }
    return { ok: true };
  }

  private completeRep(now: number): void {
    const durationMs = this.repStartedAt > 0 ? Math.round(now - this.repStartedAt) : 0;
    const totalFrames = this.repFormCounts.totalCount;
    const valgusFrames = this.currentRepValgusFramesRaw;
    const heelLiftFrames = this.currentRepHeelLiftFramesRaw;

    const validation = this.validateRepShape(now);
    if (!validation.ok) {
      debugLog('GOBLET', 'REJECT', 'Rep discarded', {
        reason: validation.reason,
        peakDepth: +this.maxFlexionThisRep.toFixed(1),
        durationMs,
        totalFrames,
        valgusFrames,
        heelLiftFrames,
        leftPeak: +this.repPeakLeftKneeDeg.toFixed(1),
        rightPeak: +this.repPeakRightKneeDeg.toFixed(1),
      });
      if (validation.reason !== 'incomplete' && validation.reason !== 'too-shallow') {
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
      smoothness: Math.round(smoothness),
      form: Math.round(form),
      mqs: Math.round(mqs),
      warnings: Array.from(this.repWarnings),
    };
    debugLog('GOBLET', 'REP', 'Rep complete', {
      ...repPayload,
      durationMs,
      totalFrames,
      valgusFrames,
      heelLiftFrames,
    });
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

    // Fix O: re-baseline once the EMA has settled, so the post-rep decay tail
    // doesn't permanently inflate max - min.
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
      debugLog('GOBLET', 'WARN', 'not-moving', {
        idleMs: Math.round(idleMs),
        flexVariance: +variance.toFixed(2),
      });
      this.callbacks.onPostureWarning?.('not-moving');
      // Reset the window so we re-arm cleanly for the next cycle
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
    this.repFormCounts = { heelOKCount: 0, kneeOKCount: 0, trunkOKCount: 0, totalCount: 0 };
    this.repWarnings = new Set();
    this.repStartedAt = 0;
    this.repPeakLeftKneeDeg = 0;
    this.repPeakRightKneeDeg = 0;
    this.currentRepValgusFramesRaw = 0;
    this.currentRepHeelLiftFramesRaw = 0;
  }

  // ----------------------------------------------------------
  // Posture gates
  // ----------------------------------------------------------
  private detectHeelLift(landmarks: PoseLandmarks, baseline: CalibrationBaseline): boolean {
    const la = landmarks[LM.LEFT_ANKLE];
    const ra = landmarks[LM.RIGHT_ANKLE];
    const currentAnkleY = (la.y + ra.y) / 2;
    const lift = baseline.ankleY - currentAnkleY;
    const isLifted = lift > HEEL_LIFT_THRESHOLD;
    if (isLifted) {
      this.heelLiftFrames++;
    } else {
      this.heelLiftFrames = 0;
    }
    return this.heelLiftFrames >= HEEL_LIFT_DEBOUNCE_FRAMES;
  }

  private detectValgus(landmarks: PoseLandmarks, baseline: CalibrationBaseline): boolean {
    const lk = landmarks[LM.LEFT_KNEE];
    const rk = landmarks[LM.RIGHT_KNEE];
    const kneeWidth = Math.abs(lk.x - rk.x);
    const baselineKneeWidth = Math.abs(baseline.leftKneeX - baseline.rightKneeX);
    if (baselineKneeWidth === 0) return false;
    const collapseRatio = 1 - kneeWidth / baselineKneeWidth;
    const isValgus = collapseRatio > VALGUS_THRESHOLD_RATIO;
    if (isValgus) {
      this.valgusFrames++;
    } else {
      this.valgusFrames = 0;
    }
    return this.valgusFrames >= VALGUS_DEBOUNCE_FRAMES;
  }

  private detectFeetNarrow(landmarks: PoseLandmarks, baseline: CalibrationBaseline): boolean {
    const la = landmarks[LM.LEFT_ANKLE];
    const ra = landmarks[LM.RIGHT_ANKLE];
    const feetWidth = Math.abs(la.x - ra.x);
    const ratio = baseline.feetWidth > 0 ? feetWidth / baseline.feetWidth : 1;
    const isNarrow = ratio < FEET_WIDTH_MIN_RATIO;
    if (isNarrow) {
      this.feetNarrowFrames++;
    } else {
      this.feetNarrowFrames = 0;
    }
    return this.feetNarrowFrames >= 6;
  }

  private detectNotFacing(landmarks: PoseLandmarks, baseline: CalibrationBaseline): boolean {
    const ls = landmarks[LM.LEFT_SHOULDER];
    const rs = landmarks[LM.RIGHT_SHOULDER];
    const shoulderWidth = Math.abs(ls.x - rs.x);
    const ratio = baseline.shoulderWidth > 0 ? shoulderWidth / baseline.shoulderWidth : 1;
    const notFacing = ratio < FACING_WIDTH_MIN_RATIO;
    if (notFacing) {
      this.facingBadFrames++;
    } else {
      this.facingBadFrames = 0;
    }
    return this.facingBadFrames >= FACING_WARN_FRAMES;
  }

  private detectDistance(
    landmarks: PoseLandmarks,
    baseline: CalibrationBaseline,
  ): { tooClose: boolean; tooFar: boolean } {
    const head = landmarks[LM.LEFT_SHOULDER];
    const foot = landmarks[LM.LEFT_ANKLE];
    if (!lmVisible(head) || !lmVisible(foot)) return { tooClose: false, tooFar: false };
    const bodyHeight = Math.abs(foot.y - head.y);
    const baseHeight = Math.abs(baseline.ankleY - baseline.shoulderMid.y);
    if (baseHeight === 0) return { tooClose: false, tooFar: false };
    const ratio = bodyHeight / baseHeight;
    let tooClose = false;
    let tooFar = false;
    if (bodyHeight < BODY_HEIGHT_MIN_RATIO) tooFar = true;
    else if (ratio > 1.35) tooClose = true;
    if (tooClose || tooFar) {
      this.distanceBadFrames++;
    } else {
      this.distanceBadFrames = 0;
    }
    const confirmed = this.distanceBadFrames >= DISTANCE_WARN_FRAMES;
    return { tooClose: confirmed && tooClose, tooFar: confirmed && tooFar };
  }

  private maybeEmitWarning(type: WarningType, active: boolean, now: number): void {
    if (!active) return;
    const last = this.warningCooldowns[type] ?? 0;
    if (now - last < WARNING_REPEAT_COOLDOWN_MS) return;
    this.warningCooldowns[type] = now;
    debugLog('GOBLET', 'WARN', type);
    this.callbacks.onPostureWarning?.(type);
  }

  // ----------------------------------------------------------
  // Fix N: position-lost detection
  // ----------------------------------------------------------

  /** Mirrors the coreOk check inside processTrackingFrame. */
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
    debugLog('GOBLET', 'WARN', 'position-lost', { lostMs: Math.round(lostMs) });
    this.callbacks.onPostureWarning?.('position-lost');
  }
}
