/**
 * Lunge calibration — front camera, mirrors squat's 4-gate structure but with
 * `feetTogether` (instead of squat's `feetWide`) and `armsAtSides` (instead of
 * squat's `armsOverhead`). The lunge starting position is upright with feet
 * roughly hip-width and arms relaxed at sides.
 *
 * Reuses the shared `CalibrationUpdate` shape (from `@/modules/squat/types`)
 * so the play-page overlay component is shared. Field meanings are remapped:
 *   fullBodyVisible → shoulders+hips+knees+ankles all visible
 *   feetWide        → feetTogether (feet within ~1.10 of shoulder width)
 *   armsOverhead    → armsAtSides (wrists below shoulders)
 *   distanceOk      → body span in frame within acceptable range
 */
import type { PoseLandmarks } from '@/modules/pose/types';
import { LM, lmVisible, midpoint } from './geometry';
import type { LungeBaseline } from './types';
import type { CalibrationBaseline, CalibrationState, CalibrationUpdate } from '@/modules/squat/types';
import { debugLog } from '@/lib/debug';

// 2026-05-25 round 5 (§3.5): drop confirmation hold from 2000 → 200ms.
// Once all gates green, calibration confirms "instantly"; the 200ms is a
// single ~6-frame debounce against MediaPipe single-frame noise.
const CONFIRM_DURATION_MS = 200;
const BAD_POSTURE_BUFFER_MS = 300;
const TIMEOUT_MS = 20000;

// Feet-together: ankle width should be no more than ~1.10× shoulder width
// (lunges start hip-width; shoulder-wide stance is squat territory).
const MAX_FEET_RATIO = 1.10;

const BODY_HEIGHT_MIN = 0.45;
const BODY_HEIGHT_MAX = 0.92;

const REQUIRED_LM = [
  LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER,
  LM.LEFT_HIP, LM.RIGHT_HIP,
  LM.LEFT_KNEE, LM.RIGHT_KNEE,
  LM.LEFT_ANKLE, LM.RIGHT_ANKLE,
];

export class LungeCalibration {
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
      debugLog('LUNGE', 'CALIB', `${prevState} → ${this.state}`, {
        gates: {
          fullBody: checks.fullBodyVisible,
          feetTogether: checks.feetWide,
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
    const feetTogether = shoulderWidth > 0 && feetWidth / shoulderWidth <= MAX_FEET_RATIO;

    // Arms at sides: wrists below shoulders. (Opposite of squat's arms-overhead.)
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
        feetWide: feetTogether,     // remap: "wide" slot now means "together"
        armsOverhead: armsAtSides,  // remap: "overhead" slot now means "at sides"
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

/**
 * The shared `CalibrationUpdate.baseline` field is typed as squat's baseline.
 * We adapt — only the fields the play-page actually reads are populated.
 */
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
