/**
 * Calf Raise calibration — 4 gates mirroring bicep-curl's structure, remapped:
 *   fullBodyVisible → shoulders+elbows+wrists+hips+knees+ankles visible
 *                     (knees required so calf-raise has full leg context)
 *   feetWide        → feetHipWidth (feet within 0.5×–1.5× shoulder width)
 *   armsOverhead    → armsAtSides   (BOTH elbows at flex < 25° — arms hanging)
 *   distanceOk      → body span in frame + shoulderWidth ≥ MIN_SHOULDER_WIDTH
 *                     (Fix X cal side — rejects degenerate baselines that
 *                     would collapse every runtime distance threshold)
 *
 * Baseline captures the flat-foot ankle Y (averaged L+R) — the reference for
 * heel-rise delta during reps.
 */
import type { PoseLandmarks } from '@/modules/pose/types';
import type { CalibrationState, CalibrationUpdate } from '@/modules/squat/types';
import { LM, lmVisible, midpoint } from './geometry';
import { elbowFlexionDeg } from '@/modules/pushup/geometry';
import type { CalfRaiseBaseline } from './types';
import { debugLog } from '@/lib/debug';

const CONFIRM_DURATION_MS = 200;          // Fix G — near-instant confirm
const BAD_POSTURE_BUFFER_MS = 300;        // Fix F — short hysteresis on gate drops
const TIMEOUT_MS = 20000;                 // Fix J — retry UI takes over after 20 s

// 2026-05-25 round 13 (Fix X cal side): reject confirmation when the captured
// shoulderWidth is degenerately small. Without this floor MediaPipe bad-frame
// baselines (shoulderWidth ≈ 0.024) collapse every distance-normalized
// threshold at runtime and posture warnings fire constantly. Mirror tag in
// engine.ts `MIN_SHOULDER_WIDTH_RUNTIME` (geometry.ts).
const MIN_SHOULDER_WIDTH = 0.08;

// Feet within a hip-width window around the user's shoulder width. Bicep curl
// uses a one-sided MAX of 1.20× because squat-stance triggers fail-out; calf
// raise wants feet roughly hip-width, so we constrain both sides — neither
// pinched together nor stepped wide.
const FEET_WIDTH_MIN_RATIO = 0.5;
const FEET_WIDTH_MAX_RATIO = 1.5;

const ARMS_EXTENDED_FLEX_MAX = 25;        // both elbows < 25° flex → arms hanging at sides

const BODY_HEIGHT_MIN = 0.45;
const BODY_HEIGHT_MAX = 0.92;

const REQUIRED_LM = [
  LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER,
  LM.LEFT_ELBOW, LM.RIGHT_ELBOW,
  LM.LEFT_WRIST, LM.RIGHT_WRIST,
  LM.LEFT_HIP, LM.RIGHT_HIP,
  LM.LEFT_KNEE, LM.RIGHT_KNEE,
  LM.LEFT_ANKLE, LM.RIGHT_ANKLE,
];

export class CalfRaiseCalibration {
  private startedAt: number;
  private goodPostureStart = 0;
  private badPostureStart = 0;
  private confirmedBaseline: CalfRaiseBaseline | null = null;
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
      return {
        state: this.state,
        progressMs: CONFIRM_DURATION_MS,
        checks: this.lastChecks,
        distanceHint: null,
        baseline: this.confirmedBaseline ?? undefined,
      };
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
      debugLog('CALF', 'CALIB', `${prevState} → ${this.state}`, {
        gates: {
          fullBody: checks.fullBodyVisible,
          feetHipWidth: checks.feetWide,
          armsAtSides: checks.armsOverhead,
          dist: checks.distanceOk,
        },
        distHint: distanceHint,
      });
    }

    return this.makeUpdate();
  }

  private checkGates(landmarks: PoseLandmarks): {
    checks: CalibrationUpdate['checks'];
    distanceHint: 'too-close' | 'too-far' | null;
    baselineCandidate: CalfRaiseBaseline | null;
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
    const le = landmarks[LM.LEFT_ELBOW];
    const re = landmarks[LM.RIGHT_ELBOW];
    const lw = landmarks[LM.LEFT_WRIST];
    const rw = landmarks[LM.RIGHT_WRIST];
    const lh = landmarks[LM.LEFT_HIP];
    const rh = landmarks[LM.RIGHT_HIP];
    const lk = landmarks[LM.LEFT_KNEE];
    const rk = landmarks[LM.RIGHT_KNEE];
    const la = landmarks[LM.LEFT_ANKLE];
    const ra = landmarks[LM.RIGHT_ANKLE];

    const shoulderWidth = Math.abs(ls.x - rs.x);
    const feetWidth = Math.abs(la.x - ra.x);
    const feetRatio = shoulderWidth > 0 ? feetWidth / shoulderWidth : 0;
    const feetHipWidth = feetRatio >= FEET_WIDTH_MIN_RATIO && feetRatio <= FEET_WIDTH_MAX_RATIO;

    const leftElbowFlex = elbowFlexionDeg(ls, le, lw);
    const rightElbowFlex = elbowFlexionDeg(rs, re, rw);
    const armsAtSides = leftElbowFlex < ARMS_EXTENDED_FLEX_MAX && rightElbowFlex < ARMS_EXTENDED_FLEX_MAX;

    const shoulderY = (ls.y + rs.y) / 2;
    const ankleY = (la.y + ra.y) / 2;
    const bodyHeight = Math.abs(ankleY - shoulderY);
    let distanceOk = true;
    let distanceHint: 'too-close' | 'too-far' | null = null;
    if (bodyHeight < BODY_HEIGHT_MIN) {
      distanceOk = false;
      distanceHint = 'too-far';
    } else if (bodyHeight > BODY_HEIGHT_MAX) {
      distanceOk = false;
      distanceHint = 'too-close';
    } else if (shoulderWidth < MIN_SHOULDER_WIDTH) {
      // Fix X cal side: body-height in range but shoulderWidth degenerate
      // (sideways camera angle, partial occlusion). Reject as too-far so the
      // user re-positions instead of locking in a baseline that collapses
      // every runtime threshold.
      distanceOk = false;
      distanceHint = 'too-far';
    }

    const checks = {
      fullBodyVisible: true,
      feetWide: feetHipWidth,        // remap: "wide" slot → "hip-width window"
      armsOverhead: armsAtSides,     // remap: "overhead" → "hanging at sides"
      distanceOk,
    };

    if (!checks.feetWide || !checks.armsOverhead || !checks.distanceOk) {
      return { checks, distanceHint, baselineCandidate: null };
    }

    const shoulderMid = midpoint(ls, rs);
    const hipMid = midpoint(lh, rh);
    // 2026-05-28 round 22: trunkLength used by the hold engine to size the
    // initial RISE_THRESHOLD before the adaptive percentile threshold takes
    // over (BB6 pattern). Shoulder Y → hip Y vertical distance.
    const trunkLength = Math.abs(hipMid.y - shoulderMid.y);
    const baseline: CalfRaiseBaseline = {
      shoulderMid,
      hipMid,
      hipWidth: Math.abs(lh.x - rh.x),
      shoulderWidth,
      torsoHeight: trunkLength,
      ankleY,
      feetWidth,
      feetVsShoulderRatio: feetRatio,
      leftKneeX: lk.x,
      rightKneeX: rk.x,
      baselineAnkleY: ankleY,
      baselineLeftAnkleY: la.y,
      baselineRightAnkleY: ra.y,
      shoulderMidX: shoulderMid.x,
      trunkLength,
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
      baseline: this.confirmedBaseline ?? undefined,
    };
  }

  isConfirmed(): boolean { return this.state === 'confirmed'; }
  getBaseline(): CalfRaiseBaseline | null { return this.confirmedBaseline; }
}
