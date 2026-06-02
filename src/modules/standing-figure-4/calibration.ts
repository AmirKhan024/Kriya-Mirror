/**
 * Standing Figure-4 calibration — clones Tree Pose's 4 gates (the crossed
 * figure-4 ankle sits at standing-knee height and near the standing-knee X,
 * which is exactly Tree Pose's "foot lifted AND on the standing leg" geometry):
 *   fullBodyVisible → shoulders+hips+knees+ankles+wrists visible
 *   feetWide        → oneFootLifted (Fix Y knee-confirmed) AND foot-on-knee
 *                     (crossed ankle X near standing-knee X)
 *   armsOverhead    → armsReady (hands at chest/prayer OR overhead)
 *   distanceOk      → body span in frame, Fix X shoulderWidth floor
 */
import type { PoseLandmarks } from '@/modules/pose/types';
import type { CalibrationState, CalibrationUpdate } from '@/modules/squat/types';
import { LM, lmVisible } from './geometry';
import type { Figure4Baseline } from './types';
import { debugLog } from '@/lib/debug';

const CONFIRM_DURATION_MS = 200;
const BAD_POSTURE_BUFFER_MS = 300;
const TIMEOUT_MS = 20_000;

// Knee-confirmed lift detection (Fix Y), same as Tree Pose / SLS.
const LIFTED_FOOT_RATIO = 0.40;
const LIFTED_KNEE_RATIO = 0.30;

// Foot-on-knee gate: crossed ankle X within ±this distance of the standing-
// knee X. Conservative on the wider side; physical test may tighten.
const FOOT_ON_LEG_X_TOLERANCE_AT_CAL = 0.08;

// Widened (physical test: the distance gate rejected good positions).
const BODY_HEIGHT_MIN = 0.35;
const BODY_HEIGHT_MAX = 1.00;

// Fix X — narrow shoulderWidth = degenerate baseline → surface as too-far.
const MIN_SHOULDER_WIDTH = 0.08;

// Arms-ready: wrists at chest level OR above shoulders.
const WRIST_AT_CHEST_TOLERANCE = 0.05;

const REQUIRED_LM = [
  LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER,
  LM.LEFT_HIP, LM.RIGHT_HIP,
  LM.LEFT_KNEE, LM.RIGHT_KNEE,
  LM.LEFT_ANKLE, LM.RIGHT_ANKLE,
  LM.LEFT_WRIST, LM.RIGHT_WRIST,
];

export class StandingFigure4Calibration {
  private startedAt: number;
  private goodPostureStart = 0;
  private badPostureStart = 0;
  private confirmedBaseline: Figure4Baseline | null = null;
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
      debugLog('FIG4', 'CALIB', `${prevState} → ${this.state}`, {
        gates: {
          fullBody: checks.fullBodyVisible,
          footOnKnee: checks.feetWide,
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
    baselineCandidate: Figure4Baseline | null;
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

    // Fix Y — knee-confirmed lift detection.
    const ankleYDiff = Math.abs(la.y - ra.y);
    const kneeYDiff = Math.abs(lk.y - rk.y);
    const ankleLifted = shoulderWidth > 0 && (ankleYDiff / shoulderWidth) > LIFTED_FOOT_RATIO;
    const kneeLifted = shoulderWidth > 0 && (kneeYDiff / shoulderWidth) > LIFTED_KNEE_RATIO;
    const oneFootLifted = ankleLifted && kneeLifted;
    const liftedSide: 'left' | 'right' = lk.y < rk.y ? 'left' : 'right';

    // Foot-on-knee: crossed ankle X within tolerance of standing-knee X.
    const liftedAnkle = liftedSide === 'left' ? la : ra;
    const standingKnee = liftedSide === 'left' ? rk : lk;
    const footOnLegDistance = Math.abs(liftedAnkle.x - standingKnee.x);
    const footOnLeg = footOnLegDistance < FOOT_ON_LEG_X_TOLERANCE_AT_CAL;

    const feetWideGate = oneFootLifted && footOnLeg;

    // Arms ready: at chest band OR clearly overhead. Figure-4 hands are at chest.
    const shoulderY = (ls.y + rs.y) / 2;
    const hipY = (lh.y + rh.y) / 2;
    const wristYAvg = (lw.y + rw.y) / 2;
    const chestBandTop = shoulderY - WRIST_AT_CHEST_TOLERANCE;
    const chestBandBottom = (shoulderY + hipY) / 2;
    const handsAtChest = wristYAvg >= chestBandTop && wristYAvg <= chestBandBottom;
    const handsOverhead = wristYAvg < shoulderY - WRIST_AT_CHEST_TOLERANCE;
    const armsReady = handsAtChest || handsOverhead;

    // Distance gate.
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
      feetWide: feetWideGate,       // remap: "wide" slot → "ankle crossed onto the standing knee"
      armsOverhead: armsReady,      // remap: "overhead" slot → "hands at chest or overhead"
      distanceOk,
    };

    if (!checks.feetWide || !checks.armsOverhead || !checks.distanceOk) {
      return { checks, distanceHint, baselineCandidate: null };
    }

    const baseline: Figure4Baseline = {
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
  getBaseline(): Figure4Baseline | null { return this.confirmedBaseline; }
}
