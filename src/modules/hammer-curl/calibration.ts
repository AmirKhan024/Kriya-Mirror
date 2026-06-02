/**
 * Hammer Curl calibration — 4 gates mirroring bicep-curl's structure:
 *   fullBodyVisible → shoulders+elbows+wrists+hips+ankles visible
 *   feetWide        → feetStable (feet within 1.20× shoulder width)
 *   armsOverhead    → armsExtended (BOTH elbows at flex < 25° — arms hanging at sides)
 *   distanceOk      → body span in frame
 */
import type { PoseLandmarks } from '@/modules/pose/types';
import type { CalibrationState, CalibrationUpdate } from '@/modules/squat/types';
import { LM, lmVisible, midpoint, elbowFlexionDeg } from './geometry';
import type { HammerCurlBaseline } from './types';
import { debugLog } from '@/lib/debug';

const CONFIRM_DURATION_MS = 200;
const BAD_POSTURE_BUFFER_MS = 300;
const TIMEOUT_MS = 20000;

const MAX_FEET_RATIO = 1.20;
const ARMS_EXTENDED_FLEX_MAX = 25;

const BODY_HEIGHT_MIN = 0.45;
const BODY_HEIGHT_MAX = 0.92;

const REQUIRED_LM = [
  LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER,
  LM.LEFT_ELBOW, LM.RIGHT_ELBOW,
  LM.LEFT_WRIST, LM.RIGHT_WRIST,
  LM.LEFT_HIP, LM.RIGHT_HIP,
  LM.LEFT_ANKLE, LM.RIGHT_ANKLE,
];

export class HammerCurlCalibration {
  private startedAt: number;
  private goodPostureStart = 0;
  private badPostureStart = 0;
  private confirmedBaseline: HammerCurlBaseline | null = null;
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
      debugLog('HAMMER', 'CALIB', `${prevState} → ${this.state}`, {
        gates: {
          fullBody: checks.fullBodyVisible,
          feetStable: checks.feetWide,
          armsExtended: checks.armsOverhead,
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
    baselineCandidate: HammerCurlBaseline | null;
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
    const la = landmarks[LM.LEFT_ANKLE];
    const ra = landmarks[LM.RIGHT_ANKLE];

    const shoulderWidth = Math.abs(ls.x - rs.x);
    const feetWidth = Math.abs(la.x - ra.x);
    const feetStable = shoulderWidth > 0 && feetWidth / shoulderWidth <= MAX_FEET_RATIO;

    const leftElbowFlex = elbowFlexionDeg(ls, le, lw);
    const rightElbowFlex = elbowFlexionDeg(rs, re, rw);
    const armsExtended = leftElbowFlex < ARMS_EXTENDED_FLEX_MAX && rightElbowFlex < ARMS_EXTENDED_FLEX_MAX;

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
    }

    const checks = {
      fullBodyVisible: true,
      feetWide: feetStable,
      armsOverhead: armsExtended,
      distanceOk,
    };

    if (!checks.feetWide || !checks.armsOverhead || !checks.distanceOk) {
      return { checks, distanceHint, baselineCandidate: null };
    }

    const shoulderMid = midpoint(ls, rs);
    const hipMid = midpoint(lh, rh);
    const baseline: HammerCurlBaseline = {
      shoulderMid,
      hipMid,
      hipWidth: Math.abs(lh.x - rh.x),
      shoulderWidth,
      torsoHeight: Math.abs(hipMid.y - shoulderMid.y),
      ankleY,
      feetWidth,
      feetVsShoulderRatio: shoulderWidth > 0 ? feetWidth / shoulderWidth : 0,
      leftKneeX: landmarks[LM.LEFT_KNEE]?.x ?? lh.x,
      rightKneeX: landmarks[LM.RIGHT_KNEE]?.x ?? rh.x,
      leftElbowX: le.x,
      rightElbowX: re.x,
      shoulderMidX: shoulderMid.x,
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
  getBaseline(): HammerCurlBaseline | null { return this.confirmedBaseline; }
}
