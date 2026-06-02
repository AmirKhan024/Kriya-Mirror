/**
 * Cossack-Squat calibration — front camera. A clone of LungeCalibration with
 * ONE change: the `feetWide` slot requires a genuinely WIDE stance (the cossack
 * starts wide and stays wide), instead of lunge's `feetTogether`. Everything
 * else (arms-at-sides, distance band, instant 200 ms confirm, the LungeBaseline
 * shape + squat-baseline adapter) is identical, so the engine can reuse the
 * shared lunge geometry/types/scoring untouched.
 *
 * Gate semantics:
 *   fullBodyVisible → shoulders+hips+knees+ankles all visible
 *   feetWide        → wide stance (ankle/shoulder ratio in [1.3, 2.6])
 *   armsOverhead    → armsAtSides (wrists below shoulders)
 *   distanceOk      → body span in frame within range
 */
import type { PoseLandmarks } from '@/modules/pose/types';
import { LM, lmVisible, midpoint } from '@/modules/lunge/geometry';
import type { LungeBaseline } from '@/modules/lunge/types';
import type { CalibrationBaseline, CalibrationState, CalibrationUpdate } from '@/modules/squat/types';
import { debugLog } from '@/lib/debug';

const CONFIRM_DURATION_MS = 200;
const BAD_POSTURE_BUFFER_MS = 300;
const TIMEOUT_MS = 20000;

// Wide stance: ankle width clearly wider than the shoulders (a cossack stance is
// ~1.5–2.2× shoulder width). Lenient band; physical test may tighten.
const MIN_WIDE_RATIO = 1.3;
const MAX_WIDE_RATIO = 2.6;

// Widened (physical test: the distance gate rejected good positions).
const BODY_HEIGHT_MIN = 0.35;
const BODY_HEIGHT_MAX = 1.00;

const REQUIRED_LM = [
  LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER,
  LM.LEFT_HIP, LM.RIGHT_HIP,
  LM.LEFT_KNEE, LM.RIGHT_KNEE,
  LM.LEFT_ANKLE, LM.RIGHT_ANKLE,
];

export class CossackSquatCalibration {
  private startedAt: number;
  private goodPostureStart = 0;
  private badPostureStart = 0;
  private confirmedBaseline: LungeBaseline | null = null;
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
      debugLog('COSSACK', 'CALIB', `${prevState} → ${this.state}`, {
        gates: {
          fullBody: checks.fullBodyVisible,
          wideStance: checks.feetWide,
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
    const ratio = shoulderWidth > 0 ? feetWidth / shoulderWidth : 0;
    const wideStance = ratio >= MIN_WIDE_RATIO && ratio <= MAX_WIDE_RATIO;

    // Arms at sides: wrists below shoulders.
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
        feetWide: wideStance,       // remap: "wide" slot = genuine wide stance
        armsOverhead: armsAtSides,  // remap: "overhead" slot = arms relaxed at sides
        distanceOk,
      },
      distanceHint,
    };
  }

  private captureBaseline(landmarks: PoseLandmarks): LungeBaseline {
    const ls = landmarks[LM.LEFT_SHOULDER];
    const rs = landmarks[LM.RIGHT_SHOULDER];
    const lh = landmarks[LM.LEFT_HIP];
    const rh = landmarks[LM.RIGHT_HIP];
    const la = landmarks[LM.LEFT_ANKLE];
    const ra = landmarks[LM.RIGHT_ANKLE];
    const lk = landmarks[LM.LEFT_KNEE];
    const rk = landmarks[LM.RIGHT_KNEE];

    return {
      shoulderMid: midpoint(ls, rs),
      hipMid: midpoint(lh, rh),
      shoulderWidth: Math.abs(ls.x - rs.x),
      hipWidth: Math.abs(lh.x - rh.x),
      ankleY: (la.y + ra.y) / 2,
      feetWidth: Math.abs(la.x - ra.x),
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
  getBaseline(): LungeBaseline | null { return this.confirmedBaseline; }
}

/** The shared `CalibrationUpdate.baseline` is typed as squat's baseline. */
function toSquatBaseline(b: LungeBaseline): CalibrationBaseline {
  return {
    shoulderMid: b.shoulderMid,
    hipMid: b.hipMid,
    hipWidth: b.hipWidth,
    shoulderWidth: b.shoulderWidth,
    torsoHeight: Math.abs(b.hipMid.y - b.shoulderMid.y),
    ankleY: b.ankleY,
    feetWidth: b.feetWidth,
    feetVsShoulderRatio: b.shoulderWidth > 0 ? b.feetWidth / b.shoulderWidth : 0,
    leftKneeX: b.leftKneeX,
    rightKneeX: b.rightKneeX,
  };
}
