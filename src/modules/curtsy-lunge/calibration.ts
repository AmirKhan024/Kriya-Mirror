/**
 * Curtsy Lunge calibration — front camera, mirrors lunge's 4-gate structure.
 *
 * Starting position: standing upright, feet hip-width apart (NOT crossed yet),
 * arms relaxed at sides.
 *
 * Gates:
 *   fullBodyVisible → shoulders+hips+knees+ankles all visible
 *   feetWide        → feet hip-width (ratio 0.7–1.4 of hip-width)
 *   armsOverhead    → arms at sides (wrists below hips)
 *   distanceOk      → body height in frame within valid range
 *
 * Reuses the shared `CalibrationUpdate` shape (from `@/modules/squat/types`)
 * so the play-page overlay component is shared. Field meanings are remapped.
 *
 * Implements:
 *   Fix F — hysteresis on distance gate (ENTER vs EXIT thresholds)
 *   Fix G — instant confirm (CONFIRM_DURATION_MS = 200)
 *   Fix H — distance hints ('too-close' | 'too-far')
 *   Fix J — calibration timeout (TIMEOUT_MS = 20000)
 */
import type { PoseLandmarks } from '@/modules/pose/types';
import type { CurtsyLungeBaseline } from './types';
import type { CalibrationBaseline, CalibrationState, CalibrationUpdate } from '@/modules/squat/types';
import { debugLog } from '@/lib/debug';

// NOTE: 'CURTSY-LUNGE' EngineTag is added by the Integration Agent. Until then
// use the existing 'LUNGE' tag as a placeholder.
const CAL_TAG = 'LUNGE' as const;

// Fix G: instant confirm
const CONFIRM_DURATION_MS = 200;
const BAD_POSTURE_BUFFER_MS = 300;
// Fix J: calibration timeout
const TIMEOUT_MS = 20000;

// Feet-wide gate: feet should be hip-width (not shoulder-width)
// curtsy lunge starts hip-width apart
const MIN_FEET_RATIO = 0.7;
const MAX_FEET_RATIO = 1.4;

// Fix F: hysteresis on distance gate
const BODY_HEIGHT_MIN_ENTER = 0.45;
const BODY_HEIGHT_MIN_EXIT = 0.48;
const BODY_HEIGHT_MAX_ENTER = 0.92;
const BODY_HEIGHT_MAX_EXIT = 0.89;

// Landmark indices
const LM_LEFT_SHOULDER = 11;
const LM_RIGHT_SHOULDER = 12;
const LM_LEFT_HIP = 23;
const LM_RIGHT_HIP = 24;
const LM_LEFT_KNEE = 25;
const LM_RIGHT_KNEE = 26;
const LM_LEFT_ANKLE = 27;
const LM_RIGHT_ANKLE = 28;
const LM_LEFT_WRIST = 15;
const LM_RIGHT_WRIST = 16;

const VIS_THRESHOLD = 0.5;

const REQUIRED_LM = [
  LM_LEFT_SHOULDER, LM_RIGHT_SHOULDER,
  LM_LEFT_HIP, LM_RIGHT_HIP,
  LM_LEFT_KNEE, LM_RIGHT_KNEE,
  LM_LEFT_ANKLE, LM_RIGHT_ANKLE,
];

function lmOk(lm: { visibility?: number } | undefined): boolean {
  return !!lm && (lm.visibility ?? 0) >= VIS_THRESHOLD;
}

export class CurtsyLungeCalibration {
  private startedAt: number;
  private goodPostureStart = 0;
  private badPostureStart = 0;
  private confirmedBaseline: CurtsyLungeBaseline | null = null;
  private state: CalibrationState = 'waiting';
  private lastChecks: CalibrationUpdate['checks'] = {
    fullBodyVisible: false, feetWide: false, armsOverhead: false, distanceOk: false,
  };
  private lastDistanceHint: 'too-close' | 'too-far' | null = null;
  // Fix F: track current distance-ok state for hysteresis
  private distanceOkState = false;

  constructor() {
    this.startedAt = 0; // seeded from first update() call (supports test harness)
  }

  update(landmarks: PoseLandmarks | null, now: number): CalibrationUpdate {
    // Seed startedAt from first real timestamp (supports test harness using tMs)
    if (this.startedAt === 0) this.startedAt = now;

    if (this.state === 'confirmed') {
      return {
        state: this.state,
        progressMs: CONFIRM_DURATION_MS,
        checks: this.lastChecks,
        distanceHint: null,
        baseline: this.confirmedBaseline ? toCaliBaseline(this.confirmedBaseline) : undefined,
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
      debugLog(CAL_TAG, 'CALIB', `${prevState} → ${this.state}`, {
        gates: {
          fullBody: checks.fullBodyVisible,
          feetWide: checks.feetWide,
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
    const fullBodyVisible = REQUIRED_LM.every((i) => lmOk(landmarks[i]));
    if (!fullBodyVisible) {
      return {
        checks: { fullBodyVisible: false, feetWide: false, armsOverhead: false, distanceOk: false },
        distanceHint: null,
      };
    }

    const ls = landmarks[LM_LEFT_SHOULDER];
    const rs = landmarks[LM_RIGHT_SHOULDER];
    const lh = landmarks[LM_LEFT_HIP];
    const rh = landmarks[LM_RIGHT_HIP];
    const la = landmarks[LM_LEFT_ANKLE];
    const ra = landmarks[LM_RIGHT_ANKLE];
    const lw = landmarks[LM_LEFT_WRIST];
    const rw = landmarks[LM_RIGHT_WRIST];

    // Feet-wide gate: feet between 0.7–1.4× hip-width
    const hipWidth = Math.abs(lh.x - rh.x);
    const feetWidth = Math.abs(la.x - ra.x);
    const feetWide = hipWidth > 0 && (feetWidth / hipWidth) >= MIN_FEET_RATIO && (feetWidth / hipWidth) <= MAX_FEET_RATIO;

    // Arms at sides: wrists below hips (NOT raised)
    const wristsVisible = lmOk(lw) && lmOk(rw);
    const armsAtSides = wristsVisible && lw.y > lh.y && rw.y > rh.y;

    // Distance gate with Fix F hysteresis
    const shoulderY = (ls.y + rs.y) / 2;
    const ankleY = (la.y + ra.y) / 2;
    const bodyHeight = Math.abs(ankleY - shoulderY);

    let distanceOk: boolean;
    let distanceHint: 'too-close' | 'too-far' | null = null;

    if (this.distanceOkState) {
      // Currently IN the valid range — use EXIT thresholds (hysteresis)
      if (bodyHeight < BODY_HEIGHT_MIN_EXIT) {
        distanceOk = false;
        distanceHint = 'too-far';
      } else if (bodyHeight > BODY_HEIGHT_MAX_EXIT) {
        distanceOk = false;
        distanceHint = 'too-close';
      } else {
        distanceOk = true;
      }
    } else {
      // Currently OUTSIDE — use ENTER thresholds
      if (bodyHeight < BODY_HEIGHT_MIN_ENTER) {
        distanceOk = false;
        distanceHint = 'too-far';
      } else if (bodyHeight > BODY_HEIGHT_MAX_ENTER) {
        distanceOk = false;
        distanceHint = 'too-close';
      } else {
        distanceOk = true;
      }
    }
    this.distanceOkState = distanceOk;

    return {
      checks: {
        fullBodyVisible,
        feetWide,
        armsOverhead: armsAtSides,   // remap: "overhead" slot = "at sides"
        distanceOk,
      },
      distanceHint,
    };
  }

  private captureBaseline(landmarks: PoseLandmarks): CurtsyLungeBaseline {
    const ls = landmarks[LM_LEFT_SHOULDER];
    const rs = landmarks[LM_RIGHT_SHOULDER];
    const lh = landmarks[LM_LEFT_HIP];
    const rh = landmarks[LM_RIGHT_HIP];
    const la = landmarks[LM_LEFT_ANKLE];
    const ra = landmarks[LM_RIGHT_ANKLE];
    const lk = landmarks[LM_LEFT_KNEE];
    const rk = landmarks[LM_RIGHT_KNEE];

    const shoulderMid = { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2 };
    const hipMid = { x: (lh.x + rh.x) / 2, y: (lh.y + rh.y) / 2 };

    return {
      hipMid,
      shoulderMid,
      hipWidth: Math.abs(lh.x - rh.x),
      shoulderWidth: Math.abs(ls.x - rs.x),
      torsoHeight: Math.abs(hipMid.y - shoulderMid.y),
      ankleY: (la.y + ra.y) / 2,
      leftKneeX: lk.x,
      rightKneeX: rk.x,
      leftAnkleX: la.x,
      rightAnkleX: ra.x,
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
      baseline: this.confirmedBaseline ? toCaliBaseline(this.confirmedBaseline) : undefined,
    };
  }

  isConfirmed(): boolean { return this.state === 'confirmed'; }
  getBaseline(): CurtsyLungeBaseline | null { return this.confirmedBaseline; }
}

/**
 * Adapter: map CurtsyLungeBaseline to the shared CalibrationBaseline shape
 * that the play-page overlay reads.
 */
function toCaliBaseline(b: CurtsyLungeBaseline): CalibrationBaseline {
  return {
    shoulderMid: b.shoulderMid,
    hipMid: b.hipMid,
    hipWidth: b.hipWidth,
    shoulderWidth: b.shoulderWidth,
    torsoHeight: b.torsoHeight,
    ankleY: b.ankleY,
    feetWidth: Math.abs(b.leftAnkleX - b.rightAnkleX),
    feetVsShoulderRatio: b.shoulderWidth > 0
      ? Math.abs(b.leftAnkleX - b.rightAnkleX) / b.shoulderWidth
      : 0,
    leftKneeX: b.leftKneeX,
    rightKneeX: b.rightKneeX,
  };
}
