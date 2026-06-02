/**
 * Tree Pose calibration — 4 gates mirroring SLS, with two changes for the
 * yoga-pose semantics:
 *   fullBodyVisible → same as SLS (shoulders+hips+knees+ankles+wrists visible)
 *   feetWide        → oneFootLifted (Fix Y knee-confirmed) AND foot-on-leg
 *                     (lifted ankle X near standing-knee X)
 *   armsOverhead    → armsReady (wrists at chest level OR above shoulders) —
 *                     Tree Pose hands are at prayer (chest) or extended overhead,
 *                     NOT at sides like SLS
 *   distanceOk      → body span in frame, Fix X shoulderWidth floor
 */
import type { PoseLandmarks } from '@/modules/pose/types';
import type { CalibrationState, CalibrationUpdate } from '@/modules/squat/types';
import { LM, lmVisible } from './geometry';
import type { TreePoseBaseline } from './types';
import { debugLog } from '@/lib/debug';

// Fix G — instant calibration.
const CONFIRM_DURATION_MS = 200;
const BAD_POSTURE_BUFFER_MS = 300;
// Fix J — calibration timeout.
const TIMEOUT_MS = 20_000;

// Same lifted-foot detection as SLS (Fix Y knee-confirmed).
const LIFTED_FOOT_RATIO = 0.40;
const LIFTED_KNEE_RATIO = 0.30;

// Foot-on-leg gate (NEW for Tree Pose): lifted ankle X within ±this distance
// of the standing-knee X. Conservative on the wider side; physical test may tighten.
const FOOT_ON_LEG_X_TOLERANCE_AT_CAL = 0.08;

const BODY_HEIGHT_MIN = 0.45;
const BODY_HEIGHT_MAX = 0.92;

// Fix X — narrow shoulderWidth = degenerate baseline → surface as too-far.
const MIN_SHOULDER_WIDTH = 0.08;

// Arms-ready check: wrists at chest level OR above shoulder. "Chest level" =
// wrist Y within shoulder-to-hip vertical range. "Above shoulder" = wrist Y
// ≤ shoulder Y + small tolerance.
const WRIST_AT_CHEST_TOLERANCE = 0.05;       // vertical tolerance for "at chest" check

const REQUIRED_LM = [
  LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER,
  LM.LEFT_HIP, LM.RIGHT_HIP,
  LM.LEFT_KNEE, LM.RIGHT_KNEE,
  LM.LEFT_ANKLE, LM.RIGHT_ANKLE,
  LM.LEFT_WRIST, LM.RIGHT_WRIST,
];

export class TreePoseCalibration {
  private startedAt: number;
  private goodPostureStart = 0;
  private badPostureStart = 0;
  private confirmedBaseline: TreePoseBaseline | null = null;
  private state: CalibrationState = 'waiting';
  private lastChecks: CalibrationUpdate['checks'] = {
    fullBodyVisible: false, feetWide: false, armsOverhead: false, distanceOk: false,
  };
  private lastDistanceHint: 'too-close' | 'too-far' | null = null;

  constructor() {
    this.startedAt = performance.now();
  }

  update(landmarks: PoseLandmarks | null, now: number): CalibrationUpdate {
    if (this.state === 'confirmed') {
      return this.makeUpdate();
    }
    if (now - this.startedAt > TIMEOUT_MS) {
      this.state = 'timeout';
      return this.makeUpdate();
    }
    if (!landmarks) {
      this.resetProgress();
      this.lastChecks = { fullBodyVisible: false, feetWide: false, armsOverhead: false, distanceOk: false };
      this.lastDistanceHint = null;
      return this.makeUpdate();
    }

    const { checks, distanceHint, baselineCandidate } = this.checkGates(landmarks);
    this.lastChecks = checks;
    this.lastDistanceHint = distanceHint;
    const allPass = checks.fullBodyVisible && checks.feetWide && checks.armsOverhead && checks.distanceOk;

    const prevState = this.state;
    if (allPass && baselineCandidate) {
      this.badPostureStart = 0;
      if (this.goodPostureStart === 0) this.goodPostureStart = now;
      const heldMs = now - this.goodPostureStart;
      if (heldMs >= CONFIRM_DURATION_MS) {
        this.confirmedBaseline = baselineCandidate;
        this.state = 'confirmed';
      } else {
        this.state = 'good';
      }
    } else {
      if (this.goodPostureStart > 0) {
        if (this.badPostureStart === 0) this.badPostureStart = now;
        if (now - this.badPostureStart > BAD_POSTURE_BUFFER_MS) this.resetProgress();
      }
      this.state = 'waiting';
    }

    if (prevState !== this.state) {
      debugLog('TREE', 'CALIB', `${prevState} → ${this.state}`, {
        gates: {
          fullBody: checks.fullBodyVisible,
          footOnLeg: checks.feetWide,
          armsReady: checks.armsOverhead,
          dist: checks.distanceOk,
        },
        distHint: distanceHint,
        liftedSide: baselineCandidate?.liftedSide,
      });
    }

    return this.makeUpdate();
  }

  private checkGates(landmarks: PoseLandmarks): {
    checks: CalibrationUpdate['checks'];
    distanceHint: 'too-close' | 'too-far' | null;
    baselineCandidate: TreePoseBaseline | null;
  } {
    const fullBodyVisible = REQUIRED_LM.every((i) => lmVisible(landmarks[i]));
    if (!fullBodyVisible) {
      return {
        checks: { fullBodyVisible: false, feetWide: false, armsOverhead: false, distanceOk: false },
        distanceHint: null,
        baselineCandidate: null,
      };
    }

    const ls = landmarks[LM.LEFT_SHOULDER];
    const rs = landmarks[LM.RIGHT_SHOULDER];
    const lh = landmarks[LM.LEFT_HIP];
    const rh = landmarks[LM.RIGHT_HIP];
    const lk = landmarks[LM.LEFT_KNEE];
    const rk = landmarks[LM.RIGHT_KNEE];
    const la = landmarks[LM.LEFT_ANKLE];
    const ra = landmarks[LM.RIGHT_ANKLE];
    const lw = landmarks[LM.LEFT_WRIST];
    const rw = landmarks[LM.RIGHT_WRIST];

    const shoulderWidth = Math.abs(ls.x - rs.x);

    // Fix Y — knee-confirmed lift detection (same as SLS).
    const ankleYDiff = Math.abs(la.y - ra.y);
    const kneeYDiff = Math.abs(lk.y - rk.y);
    const ankleLifted = shoulderWidth > 0 && (ankleYDiff / shoulderWidth) > LIFTED_FOOT_RATIO;
    const kneeLifted = shoulderWidth > 0 && (kneeYDiff / shoulderWidth) > LIFTED_KNEE_RATIO;
    const oneFootLifted = ankleLifted && kneeLifted;
    const liftedSide: 'left' | 'right' = lk.y < rk.y ? 'left' : 'right';

    // Foot-on-leg check (NEW): lifted ankle X within tolerance of standing-knee X.
    const liftedAnkle = liftedSide === 'left' ? la : ra;
    const standingKnee = liftedSide === 'left' ? rk : lk;
    const footOnLegDistance = Math.abs(liftedAnkle.x - standingKnee.x);
    const footOnLeg = footOnLegDistance < FOOT_ON_LEG_X_TOLERANCE_AT_CAL;

    // Combined: both lifted AND on leg = "feetWide" gate green.
    const feetWideGate = oneFootLifted && footOnLeg;

    // Arms ready: wrists at chest level (within vertical band between shoulder
    // and hip) OR clearly above shoulders (overhead). Tree Pose allows both.
    const shoulderY = (ls.y + rs.y) / 2;
    const hipY = (lh.y + rh.y) / 2;
    const wristYAvg = (lw.y + rw.y) / 2;
    const chestBandTop = shoulderY - WRIST_AT_CHEST_TOLERANCE;
    const chestBandBottom = (shoulderY + hipY) / 2; // mid-torso
    const handsAtChest = wristYAvg >= chestBandTop && wristYAvg <= chestBandBottom;
    const handsOverhead = wristYAvg < shoulderY - WRIST_AT_CHEST_TOLERANCE;
    const armsReady = handsAtChest || handsOverhead;

    // Distance gate (mirrors SLS).
    const ankleYAvg = (la.y + ra.y) / 2;
    const bodyHeight = Math.abs(ankleYAvg - shoulderY);
    let distanceOk = true;
    let distanceHint: 'too-close' | 'too-far' | null = null;
    if (bodyHeight < BODY_HEIGHT_MIN || shoulderWidth < MIN_SHOULDER_WIDTH) {
      distanceOk = false;
      distanceHint = 'too-far';
    } else if (bodyHeight > BODY_HEIGHT_MAX) {
      distanceOk = false;
      distanceHint = 'too-close';
    }

    const checks = {
      fullBodyVisible: true,
      feetWide: feetWideGate,       // remap: "wide" slot → "foot lifted AND on standing leg"
      armsOverhead: armsReady,      // remap: "overhead" slot → "at chest or overhead"
      distanceOk,
    };

    if (!checks.feetWide || !checks.armsOverhead || !checks.distanceOk) {
      return { checks, distanceHint, baselineCandidate: null };
    }

    const baseline: TreePoseBaseline = {
      comX: (lh.x + rh.x) / 2 * 0.6 + (ls.x + rs.x) / 2 * 0.4,
      comY: (lh.y + rh.y) / 2 * 0.6 + (ls.y + rs.y) / 2 * 0.4,
      shoulderWidth,
      liftedSide,
      standingAnkleY: liftedSide === 'left' ? ra.y : la.y,
      liftedAnkleY: liftedSide === 'left' ? la.y : ra.y,
      standingKneeX: liftedSide === 'left' ? rk.x : lk.x,
      shoulderY,
    };
    return { checks, distanceHint, baselineCandidate: baseline };
  }

  private resetProgress() {
    this.goodPostureStart = 0;
    this.badPostureStart = 0;
  }

  private makeUpdate(): CalibrationUpdate {
    return {
      state: this.state,
      progressMs: this.goodPostureStart > 0
        ? Math.min(CONFIRM_DURATION_MS, performance.now() - this.goodPostureStart)
        : 0,
      checks: this.lastChecks,
      distanceHint: this.lastDistanceHint,
    };
  }

  isConfirmed(): boolean { return this.state === 'confirmed'; }
  getBaseline(): TreePoseBaseline | null { return this.confirmedBaseline; }
}
