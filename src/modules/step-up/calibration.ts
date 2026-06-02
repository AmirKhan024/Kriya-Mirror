/**
 * StepUp calibration — front camera, person standing upright, feet hip-width,
 * arms relaxed at sides. Step or chair is just behind them (not in frame needed).
 *
 * Gate meanings (reuses CalibrationUpdate shape from squat):
 *   fullBodyVisible → all bilateral shoulder+hip+knee+ankle visible
 *   feetWide        → feetHipWidth: feet within 0.70–1.30 × shoulder width
 *   armsOverhead    → armsAtSides: wrists below shoulders
 *   distanceOk      → body height in acceptable range
 */
import type { PoseLandmarks } from '@/modules/pose/types';
import { LM, lmVisible, midpoint } from './geometry';
import type { StepUpBaseline } from './types';
import type { CalibrationBaseline, CalibrationState, CalibrationUpdate } from '@/modules/squat/types';
import { debugLog } from '@/lib/debug';

// Fix G: instant confirm once all gates green
const CONFIRM_DURATION_MS = 200;
const BAD_POSTURE_BUFFER_MS = 300;
const TIMEOUT_MS = 20000;

// Feet hip-width: ankle width should be within 0.70–1.30× shoulder width
const MIN_FEET_RATIO = 0.70;
const MAX_FEET_RATIO = 1.30;

const BODY_HEIGHT_MIN = 0.45;
const BODY_HEIGHT_MAX = 0.92;

const REQUIRED_LM = [
  LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER,
  LM.LEFT_HIP, LM.RIGHT_HIP,
  LM.LEFT_KNEE, LM.RIGHT_KNEE,
  LM.LEFT_ANKLE, LM.RIGHT_ANKLE,
];

export class StepUpCalibration {
  private startedAt = -1;  // initialized on first update() call to `now`
  private goodPostureStart = 0;
  private badPostureStart = 0;
  private confirmedBaseline: StepUpBaseline | null = null;
  private state: CalibrationState = 'waiting';
  private lastChecks: CalibrationUpdate['checks'] = {
    fullBodyVisible: false, feetWide: false, armsOverhead: false, distanceOk: false,
  };
  private lastDistanceHint: 'too-close' | 'too-far' | null = null;

  update(landmarks: PoseLandmarks | null, now: number): CalibrationUpdate {
    if (this.startedAt < 0) this.startedAt = now;
    if (this.state === 'confirmed') {
      return {
        state: this.state,
        progressMs: CONFIRM_DURATION_MS,
        checks: this.lastChecks,
        distanceHint: null,
        baseline: this.confirmedBaseline ? toSquatBaseline(this.confirmedBaseline) : undefined,
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

    const { checks, distanceHint } = this.checkGates(landmarks);
    this.lastChecks = checks;
    this.lastDistanceHint = distanceHint;
    const allPass = checks.fullBodyVisible && checks.feetWide && checks.armsOverhead && checks.distanceOk;

    const prevState = this.state;
    if (allPass) {
      this.badPostureStart = 0;
      if (this.goodPostureStart === 0) this.goodPostureStart = now;
      const heldMs = now - this.goodPostureStart;
      if (heldMs >= CONFIRM_DURATION_MS) {
        this.confirmedBaseline = this.captureBaseline(landmarks);
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
      debugLog('STEP-UP', 'CALIB', `${prevState} → ${this.state}`, {
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
  } {
    const fullBodyVisible = REQUIRED_LM.every((i) => lmVisible(landmarks[i]));
    if (!fullBodyVisible) {
      return {
        checks: { fullBodyVisible: false, feetWide: false, armsOverhead: false, distanceOk: false },
        distanceHint: null,
      };
    }

    const ls = landmarks[LM.LEFT_SHOULDER];
    const rs = landmarks[LM.RIGHT_SHOULDER];
    const la = landmarks[LM.LEFT_ANKLE];
    const ra = landmarks[LM.RIGHT_ANKLE];
    const lw = landmarks[LM.LEFT_WRIST];
    const rw = landmarks[LM.RIGHT_WRIST];

    const shoulderWidth = Math.abs(ls.x - rs.x);
    const feetWidth = Math.abs(la.x - ra.x);
    const feetRatio = shoulderWidth > 0 ? feetWidth / shoulderWidth : 1.0;
    const feetHipWidth = feetRatio >= MIN_FEET_RATIO && feetRatio <= MAX_FEET_RATIO;

    // Arms at sides: wrists visible and below shoulders
    const wristsVisible = lmVisible(lw) && lmVisible(rw);
    const armsAtSides = wristsVisible && lw.y > ls.y && rw.y > rs.y;

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

    return {
      checks: {
        fullBodyVisible,
        feetWide: feetHipWidth,     // remap: "wide" slot = hip-width check
        armsOverhead: armsAtSides,  // remap: "overhead" slot = arms-at-sides
        distanceOk,
      },
      distanceHint,
    };
  }

  private captureBaseline(landmarks: PoseLandmarks): StepUpBaseline {
    const ls = landmarks[LM.LEFT_SHOULDER];
    const rs = landmarks[LM.RIGHT_SHOULDER];
    const lh = landmarks[LM.LEFT_HIP];
    const rh = landmarks[LM.RIGHT_HIP];
    const la = landmarks[LM.LEFT_ANKLE];
    const ra = landmarks[LM.RIGHT_ANKLE];
    const lk = landmarks[LM.LEFT_KNEE];
    const rk = landmarks[LM.RIGHT_KNEE];

    const shoulderMid = midpoint(ls, rs);
    const hipMid = midpoint(lh, rh);
    const ankleMid = midpoint(la, ra);
    const shoulderWidth = Math.abs(ls.x - rs.x);
    const feetWidth = Math.abs(la.x - ra.x);
    const shoulderY = shoulderMid.y;
    const ankleY = ankleMid.y;

    return {
      hipY: hipMid.y,
      shoulderY,
      ankleY,
      bodyLengthY: Math.abs(ankleY - shoulderY),
      shoulderMid,
      shoulderWidth,
      feetWidth,
      hipMidX: hipMid.x,
      leftKneeX: lk.x,
      rightKneeX: rk.x,
    };
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
  getBaseline(): StepUpBaseline | null { return this.confirmedBaseline; }
}

/**
 * Adapt StepUpBaseline to the shared CalibrationBaseline shape the play page reads.
 */
export function toSquatBaseline(b: StepUpBaseline): CalibrationBaseline {
  return {
    shoulderMid: b.shoulderMid,
    hipMid: { x: b.hipMidX, y: b.hipY },
    hipWidth: b.feetWidth,
    shoulderWidth: b.shoulderWidth,
    torsoHeight: Math.abs(b.hipY - b.shoulderY),
    ankleY: b.ankleY,
    feetWidth: b.feetWidth,
    feetVsShoulderRatio: b.shoulderWidth > 0 ? b.feetWidth / b.shoulderWidth : 1,
    leftKneeX: b.leftKneeX,
    rightKneeX: b.rightKneeX,
  };
}
