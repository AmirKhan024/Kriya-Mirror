/**
 * Single Leg Stand calibration — 4 gates mirroring Tandem Stand's shape:
 *   fullBodyVisible → shoulders+hips+knees+ankles+wrists visible
 *   feetWide        → oneFootLifted (ankle Y diff > 0.40 × shoulderWidth)
 *   armsOverhead    → armsRelaxed (wrists below shoulders — Y inverted)
 *   distanceOk      → body span in frame
 */
import type { PoseLandmarks } from '@/modules/pose/types';
import type { CalibrationBaseline, CalibrationUpdate } from '@/modules/squat/types';
import { LM, lmVisible } from './geometry';
import type { SingleLegStandBaseline } from './types';
import { debugLog } from '@/lib/debug';

// 2026-05-25 round 5 (§3.5): drop confirmation hold from 2000 → 200ms.
// Once all gates green, calibration confirms "instantly"; the 200ms is a
// single ~6-frame debounce against MediaPipe single-frame noise.
const CONFIRM_DURATION_MS = 200;
const BAD_POSTURE_BUFFER_MS = 300;
const TIMEOUT_MS = 20000;

const LIFTED_FOOT_RATIO = 0.40;      // |leftAnkle.y - rightAnkle.y| / shoulderWidth must exceed this
// 2026-05-25 round 14: ankle Y alone is too noisy — MediaPipe routinely
// reports 4-5% Y diffs even when both feet are on the ground (weight shift,
// foot self-occlusion). Require the KNEE to also be clearly higher on the
// lifted side. When you actually lift a leg, the knee bends → knee Y drops.
const LIFTED_KNEE_RATIO = 0.30;      // |leftKnee.y - rightKnee.y| / shoulderWidth must also exceed this

const BODY_HEIGHT_MIN = 0.45;
const BODY_HEIGHT_MAX = 0.92;

// 2026-05-25 round 13: minimum shoulder width to lock in a usable baseline.
// All hold-detection thresholds normalize by baseline.shoulderWidth, so if
// MediaPipe reports a tiny value (user at the camera edge, or one shoulder
// partially occluded so its X is poorly estimated), the thresholds collapse
// to within pixel-jitter and every form-warning fires constantly. Treating
// this as 'too-far' surfaces the right user-facing hint (Step closer).
const MIN_SHOULDER_WIDTH = 0.08;

const REQUIRED_LM = [
  LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER,
  LM.LEFT_HIP, LM.RIGHT_HIP,
  LM.LEFT_KNEE, LM.RIGHT_KNEE,
  LM.LEFT_ANKLE, LM.RIGHT_ANKLE,
  LM.LEFT_WRIST, LM.RIGHT_WRIST,
];

export class SingleLegStandCalibration {
  private startedAt: number;
  private goodPostureStart = 0;
  private badPostureStart = 0;
  private confirmedBaseline: SingleLegStandBaseline | null = null;
  private state: 'waiting' | 'good' | 'confirmed' | 'timeout' = 'waiting';
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
      debugLog('SLS', 'CALIB', `${prevState} → ${this.state}`, {
        gates: {
          fullBody: checks.fullBodyVisible,
          oneFootLifted: checks.feetWide,
          armsRelaxed: checks.armsOverhead,
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
    baselineCandidate: SingleLegStandBaseline | null;
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

    // 2026-05-25 round 14: knee-confirmed lift. Require BOTH ankle Y diff AND
    // knee Y diff to exceed thresholds. Ankle Y alone is too noisy — MediaPipe
    // routinely reports 4-5% Y diffs even with both feet on the ground. The
    // knee is more reliable: actually lifting a leg requires bending the knee,
    // which moves the knee landmark up by a clearly-detectable amount.
    // (Y inverted: smaller y = higher up in frame.)
    const ankleYDiff = Math.abs(la.y - ra.y);
    const kneeYDiff = Math.abs(lk.y - rk.y);
    const ankleLifted = shoulderWidth > 0 && (ankleYDiff / shoulderWidth) > LIFTED_FOOT_RATIO;
    const kneeLifted = shoulderWidth > 0 && (kneeYDiff / shoulderWidth) > LIFTED_KNEE_RATIO;
    const oneFootLifted = ankleLifted && kneeLifted;
    // Pick liftedSide from the knee (more reliable than ankle).
    const liftedSide: 'left' | 'right' = lk.y < rk.y ? 'left' : 'right';

    // Arms relaxed: both wrists physically below shoulders (Y inverted)
    const armsRelaxed = lw.y > ls.y && rw.y > rs.y;

    // Distance check (mirrors plank/tandem)
    const shoulderY = (ls.y + rs.y) / 2;
    const ankleYAvg = (la.y + ra.y) / 2;
    const bodyHeight = Math.abs(ankleYAvg - shoulderY);
    let distanceOk = true;
    let distanceHint: 'too-close' | 'too-far' | null = null;
    if (bodyHeight < BODY_HEIGHT_MIN || shoulderWidth < MIN_SHOULDER_WIDTH) {
      // 2026-05-25 round 13: shoulderWidth below the floor → treat as too-far.
      // Baseline would be degenerate (all distance-normalized thresholds collapse).
      distanceOk = false;
      distanceHint = 'too-far';
    } else if (bodyHeight > BODY_HEIGHT_MAX) {
      distanceOk = false;
      distanceHint = 'too-close';
    }

    const checks = {
      fullBodyVisible: true,
      feetWide: oneFootLifted,        // remap: "wide" slot → "one foot lifted"
      armsOverhead: armsRelaxed,      // remap: "overhead" slot → "arms relaxed at sides"
      distanceOk,
    };

    if (!checks.feetWide || !checks.armsOverhead || !checks.distanceOk) {
      return { checks, distanceHint, baselineCandidate: null };
    }

    const baseline: SingleLegStandBaseline = {
      comX: (lh.x + rh.x) / 2 * 0.6 + (ls.x + rs.x) / 2 * 0.4,
      comY: (lh.y + rh.y) / 2 * 0.6 + (ls.y + rs.y) / 2 * 0.4,
      shoulderWidth,
      liftedSide,
      standingAnkleY: liftedSide === 'left' ? ra.y : la.y,
      liftedAnkleY: liftedSide === 'left' ? la.y : ra.y,
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
      baseline: this.confirmedBaseline ? toSquatBaseline(this.confirmedBaseline) : undefined,
    };
  }

  isConfirmed(): boolean { return this.state === 'confirmed'; }
  getBaseline(): SingleLegStandBaseline | null { return this.confirmedBaseline; }
}

/** Type-glue: shared `CalibrationUpdate.baseline` is typed as squat's baseline. */
function toSquatBaseline(b: SingleLegStandBaseline): CalibrationBaseline {
  return {
    shoulderMid: { x: b.comX, y: b.shoulderY },
    hipMid: { x: b.comX, y: b.comY },
    hipWidth: 0,
    shoulderWidth: b.shoulderWidth,
    torsoHeight: Math.abs(b.comY - b.shoulderY),
    ankleY: b.standingAnkleY,
    feetWidth: 0,
    feetVsShoulderRatio: 0,
    leftKneeX: b.comX,
    rightKneeX: b.comX,
  };
}
