/**
 * Standing Side Leg Raise calibration — 4 gates, front camera, BOTH_DOWN start.
 * Mirrors high-knees' gate shape, remapped to the standing ready position:
 *   fullBodyVisible → shoulders+hips+knees+ankles visible (arms NOT required —
 *                     hands are free for balance / can rest on the hips)
 *   feetWide        → feetHipWidth (0.5 ≤ feetWidth/shoulderWidth ≤ 1.5)
 *   armsOverhead    → bothLegsDown (BOTH legs near-vertical, i.e. the user is
 *                     standing, not already mid-raise)
 *   distanceOk      → body span in frame + shoulderWidth ≥ MIN_SHOULDER_WIDTH (Fix X)
 *
 * Baseline captures each leg's standing abduction angle, so the engine measures
 * lift relative to the user's natural stance (feet-hip-width gives a small
 * non-zero standing abduction).
 */
import type { PoseLandmarks } from '@/modules/pose/types';
import type { CalibrationState, CalibrationUpdate } from '@/modules/squat/types';
import { LM, lmVisible, midpoint, legAbductionDeg } from './geometry';
import type { SideLegRaiseBaseline } from './types';
import { debugLog } from '@/lib/debug';

const CONFIRM_DURATION_MS = 200;          // Fix G
const BAD_POSTURE_BUFFER_MS = 300;        // Fix F
const TIMEOUT_MS = 20000;                 // Fix J

// Fix X cal side
const MIN_SHOULDER_WIDTH = 0.08;

const FEET_WIDTH_MIN_RATIO = 0.5;
const FEET_WIDTH_MAX_RATIO = 1.5;
// Both legs must be near-vertical to confirm the standing ready position. Must
// be below the engine's HIGH lift threshold so calibration only locks when the
// user is genuinely standing, not partway into a raise.
const BOTH_LEGS_DOWN_MAX_DEG = 12;

const BODY_HEIGHT_MIN = 0.45;
const BODY_HEIGHT_MAX = 0.92;

const REQUIRED_LM = [
  LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER,
  LM.LEFT_HIP, LM.RIGHT_HIP,
  LM.LEFT_KNEE, LM.RIGHT_KNEE,
  LM.LEFT_ANKLE, LM.RIGHT_ANKLE,
];

export class SideLegRaiseCalibration {
  private startedAt: number;
  private goodPostureStart = 0;
  private badPostureStart = 0;
  private confirmedBaseline: SideLegRaiseBaseline | null = null;
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
      debugLog('LEGRAISE', 'CALIB', `${prevState} → ${this.state}`, {
        gates: {
          fullBody: checks.fullBodyVisible,
          feetHipWidth: checks.feetWide,
          bothLegsDown: checks.armsOverhead,
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
    baselineCandidate: SideLegRaiseBaseline | null;
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

    const shoulderWidth = Math.abs(ls.x - rs.x);
    const feetWidth = Math.abs(la.x - ra.x);
    const feetRatio = shoulderWidth > 0 ? feetWidth / shoulderWidth : 0;
    const feetHipWidth = feetRatio >= FEET_WIDTH_MIN_RATIO && feetRatio <= FEET_WIDTH_MAX_RATIO;

    // Both legs near-vertical (standing ready position, not mid-raise).
    const leftAbd = legAbductionDeg(lh, la);
    const rightAbd = legAbductionDeg(rh, ra);
    const bothLegsDown = leftAbd < BOTH_LEGS_DOWN_MAX_DEG && rightAbd < BOTH_LEGS_DOWN_MAX_DEG;

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
      // Fix X cal side: body span looks fine but shoulderWidth is degenerate.
      distanceOk = false;
      distanceHint = 'too-far';
    }

    const checks = {
      fullBodyVisible: true,
      feetWide: feetHipWidth,        // remap: "wide" slot → "hip-width window"
      armsOverhead: bothLegsDown,    // remap: "overhead" slot → "both legs down (standing)"
      distanceOk,
    };

    if (!checks.feetWide || !checks.armsOverhead || !checks.distanceOk) {
      return { checks, distanceHint, baselineCandidate: null };
    }

    const shoulderMid = midpoint(ls, rs);
    const hipMid = midpoint(lh, rh);
    const baseline: SideLegRaiseBaseline = {
      shoulderMid,
      hipMid,
      hipWidth: Math.abs(lh.x - rh.x),
      shoulderWidth,
      torsoHeight: Math.abs(hipMid.y - shoulderMid.y),
      ankleY,
      feetWidth,
      feetVsShoulderRatio: feetRatio,
      leftKneeX: lk.x,
      rightKneeX: rk.x,
      baselineLeftAbductionDeg: leftAbd,
      baselineRightAbductionDeg: rightAbd,
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
  getBaseline(): SideLegRaiseBaseline | null { return this.confirmedBaseline; }
}
