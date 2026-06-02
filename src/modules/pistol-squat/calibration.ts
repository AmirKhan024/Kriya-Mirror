/**
 * Pistol Squat calibration — front camera, mirrors lunge's 4-gate structure but with
 * `feetOnGround` (instead of lunge's `feetTogether`) and `bodyUpright` (instead of
 * lunge's `armsAtSides`). The pistol-squat starting position is upright with both
 * feet flat on the ground (not already in pistol position).
 *
 * Reuses the shared `CalibrationUpdate` shape (from `@/modules/squat/types`)
 * so the play-page overlay component is shared. Field meanings are remapped:
 *   fullBodyVisible → shoulders+hips+knees+ankles all visible
 *   feetWide        → feetOnGround (both ankles at similar Y, diff < 10% torsoHeight)
 *   armsOverhead    → bodyUpright (trunk angle < 20°)
 *   distanceOk      → body span in frame within acceptable range
 */
import type { PoseLandmarks } from '@/modules/pose/types';
import { LM, lmVisible, midpoint, trunkLeanDeg } from './geometry';
import type { PistolSquatBaseline } from './types';
import type { CalibrationBaseline, CalibrationState, CalibrationUpdate } from '@/modules/squat/types';
import { debugLog } from '@/lib/debug';

// 2026-05-25 round 5 (§3.5): drop confirmation hold from 2000 → 200ms.
// Once all gates green, calibration confirms "instantly"; the 200ms is a
// single ~6-frame debounce against MediaPipe single-frame noise.
const CONFIRM_DURATION_MS = 200;
const BAD_POSTURE_BUFFER_MS = 300;
const TIMEOUT_MS = 30000;

const BODY_HEIGHT_MIN = 0.45;
const BODY_HEIGHT_MAX = 0.92;

// Hysteresis: ENTER threshold body-height < 0.43, EXIT > 0.47 (Fix F)
// We use the standard check: distanceOk is false if body-height < 0.45 or > 0.92.

const REQUIRED_LM = [
  LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER,
  LM.LEFT_HIP, LM.RIGHT_HIP,
  LM.LEFT_KNEE, LM.RIGHT_KNEE,
  LM.LEFT_ANKLE, LM.RIGHT_ANKLE,
];

export class PistolSquatCalibration {
  private startedAt = -1;
  private goodPostureStart = 0;
  private badPostureStart = 0;
  private confirmedBaseline: PistolSquatBaseline | null = null;
  private state: CalibrationState = 'waiting';
  private lastChecks: CalibrationUpdate['checks'] = {
    fullBodyVisible: false, feetWide: false, armsOverhead: false, distanceOk: false,
  };
  private lastDistanceHint: 'too-close' | 'too-far' | null = null;

  update(landmarks: PoseLandmarks | null, now: number): CalibrationUpdate {
    // Seed startedAt from the first frame timestamp so tests (which pass
    // frame timestamps starting at t=0) correctly trigger the 30s timeout.
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
      debugLog('PISTOL-SQUAT', 'CALIB', `${prevState} → ${this.state}`, {
        gates: {
          fullBody: checks.fullBodyVisible,
          feetOnGround: checks.feetWide,
          bodyUpright: checks.armsOverhead,
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
    const lh = landmarks[LM.LEFT_HIP];
    const rh = landmarks[LM.RIGHT_HIP];
    const la = landmarks[LM.LEFT_ANKLE];
    const ra = landmarks[LM.RIGHT_ANKLE];

    const shoulderMid = midpoint(ls, rs);
    const hipMid = midpoint(lh, rh);
    // torsoHeight = vertical distance from hip to shoulder
    const torsoHeight = Math.abs(hipMid.y - shoulderMid.y);

    // feetOnGround: both ankles at similar Y (diff < 10% of torso height)
    // User should not already be in pistol position
    const ankleDiff = Math.abs(la.y - ra.y);
    const feetOnGround = torsoHeight > 0 && ankleDiff < torsoHeight * 0.10;

    // bodyUpright: trunk angle < 20°
    const trunkDeg = trunkLeanDeg(shoulderMid, hipMid);
    const bodyUpright = trunkDeg < 20;

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
        feetWide: feetOnGround,      // remap: "wide" slot now means "on ground"
        armsOverhead: bodyUpright,   // remap: "overhead" slot now means "upright"
        distanceOk,
      },
      distanceHint,
    };
  }

  private captureBaseline(landmarks: PoseLandmarks): PistolSquatBaseline {
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

    return {
      hipMid,
      shoulderMid,
      hipWidth: Math.abs(lh.x - rh.x),
      shoulderWidth: Math.abs(ls.x - rs.x),
      torsoHeight: Math.abs(hipMid.y - shoulderMid.y),
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
  getBaseline(): PistolSquatBaseline | null { return this.confirmedBaseline; }
}

/**
 * The shared `CalibrationUpdate.baseline` field is typed as squat's baseline.
 * We adapt — only the fields the play-page actually reads are populated.
 */
function toSquatBaseline(b: PistolSquatBaseline): CalibrationBaseline {
  return {
    shoulderMid: b.shoulderMid,
    hipMid: b.hipMid,
    hipWidth: b.hipWidth,
    shoulderWidth: b.shoulderWidth,
    torsoHeight: b.torsoHeight,
    ankleY: b.ankleY,
    feetWidth: b.feetWidth,
    feetVsShoulderRatio: b.shoulderWidth > 0 ? b.feetWidth / b.shoulderWidth : 0,
    leftKneeX: b.leftKneeX,
    rightKneeX: b.rightKneeX,
  };
}
