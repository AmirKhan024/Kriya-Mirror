/**
 * Pallof Press calibration — front camera, 4-gate check.
 *
 * Reuses the shared `CalibrationUpdate` shape (from `@/modules/squat/types`)
 * so the play-page overlay component is shared. Field meanings are remapped:
 *   fullBodyVisible → both shoulders + both elbows + both wrists + both hips visible
 *   feetWide        → feet shoulder-width (feetWidth / hipWidth ratio 0.9–1.5)
 *   armsOverhead    → wrists at chest height (between shoulder and hip, not extended)
 *   distanceOk      → body height in frame between 0.45–0.92 with hysteresis (Fix F)
 *
 * Baseline captured at confirm: PallofPressBaseline for torso-rotation tracking.
 */
import type { PoseLandmarks } from '@/modules/pose/types';
import { LM, lmVisible, midpoint } from '@/modules/squat/geometry';
import type { CalibrationBaseline, CalibrationUpdate } from '@/modules/squat/types';
import type { PallofPressBaseline } from './types';
import { debugLog } from '@/lib/debug';
import type { EngineTag } from '@/lib/debug';

// Fix G: instant confirm (200ms debounce = ~6 frames at 30fps)
const CONFIRM_DURATION_MS = 200;
const BAD_POSTURE_BUFFER_MS = 300;
// Fix J: calibration timeout
const TIMEOUT_MS = 20000;

// Feet-width gate: ankle-width / hip-width between 0.9–1.5
const MIN_FEET_RATIO = 0.9;
const MAX_FEET_RATIO = 1.5;

// Fix F: hysteresis on distance gate
const BODY_HEIGHT_MIN_ENTER = 0.45;
const BODY_HEIGHT_MIN_EXIT  = 0.48;
const BODY_HEIGHT_MAX_ENTER = 0.92;
const BODY_HEIGHT_MAX_EXIT  = 0.89;

const REQUIRED_LM = [
  LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER,
  LM.LEFT_ELBOW,    LM.RIGHT_ELBOW,
  LM.LEFT_WRIST,    LM.RIGHT_WRIST,
  LM.LEFT_HIP,      LM.RIGHT_HIP,
];

export class PallofPressCalibration {
  private startedAt: number;
  private goodPostureStart = 0;
  private badPostureStart = 0;
  private confirmedBaseline: PallofPressBaseline | null = null;
  private state: 'waiting' | 'good' | 'confirmed' | 'timeout' = 'waiting';
  private lastChecks: CalibrationUpdate['checks'] = {
    fullBodyVisible: false, feetWide: false, armsOverhead: false, distanceOk: false,
  };
  private lastDistanceHint: 'too-close' | 'too-far' | null = null;
  // Fix F: persisted across frames for hysteresis
  private distInBand = false;

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

    // Fix J: timeout
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
      debugLog('PALLOF-PRESS' as EngineTag, 'CALIB', `${prevState} → ${this.state}`, {
        gates: {
          fullBody: checks.fullBodyVisible,
          feetWide: checks.feetWide,
          armsAtChest: checks.armsOverhead,
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
    // fullBodyVisible: all required landmarks visible
    const fullBodyVisible = REQUIRED_LM.every((i) => {
      const lm = landmarks[i];
      return !!lm && (lm.visibility ?? 0) > 0.5;
    });

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
    const lw = landmarks[LM.LEFT_WRIST];
    const rw = landmarks[LM.RIGHT_WRIST];

    // feetWide: feet shoulder-width (ankle width / hip width 0.9–1.5)
    const hipWidth = Math.abs(lh.x - rh.x);
    const ankleWidth = Math.abs(
      (lmVisible(la) ? la.x : lh.x) - (lmVisible(ra) ? ra.x : rh.x)
    );
    const feetRatio = hipWidth > 0.001 ? ankleWidth / hipWidth : 0;
    const feetWide = feetRatio >= MIN_FEET_RATIO && feetRatio <= MAX_FEET_RATIO;

    // armsOverhead (repurposed): wrists at chest height
    // Both wrists must be between shoulder.y + 0.05 (slightly below shoulder) and hip.y
    const shoulderMidY = (ls.y + rs.y) / 2;
    const hipMidY = (lh.y + rh.y) / 2;
    const lWristAtChest = lmVisible(lw) && lw.y >= shoulderMidY - 0.05 && lw.y <= hipMidY;
    const rWristAtChest = lmVisible(rw) && rw.y >= shoulderMidY - 0.05 && rw.y <= hipMidY;
    const armsOverhead = lWristAtChest && rWristAtChest;

    // distanceOk: body height (shoulder to ankle) with Fix F hysteresis
    const ankleY = lmVisible(la) && lmVisible(ra)
      ? (la.y + ra.y) / 2
      : lmVisible(la) ? la.y : ra?.y ?? hipMidY + 0.30;
    const bodyHeight = Math.abs(ankleY - shoulderMidY);

    const minH = this.distInBand ? BODY_HEIGHT_MIN_EXIT : BODY_HEIGHT_MIN_ENTER;
    const maxH = this.distInBand ? BODY_HEIGHT_MAX_EXIT : BODY_HEIGHT_MAX_ENTER;

    let distanceOk = true;
    let distanceHint: 'too-close' | 'too-far' | null = null;
    if (bodyHeight < minH) {
      distanceOk = false;
      distanceHint = 'too-far';
    } else if (bodyHeight > maxH) {
      distanceOk = false;
      distanceHint = 'too-close';
    }
    this.distInBand = distanceOk;

    return {
      checks: {
        fullBodyVisible,
        feetWide,
        armsOverhead,  // remap: "overhead" slot means "arms at chest"
        distanceOk,
      },
      distanceHint,
    };
  }

  private captureBaseline(landmarks: PoseLandmarks): PallofPressBaseline {
    const ls = landmarks[LM.LEFT_SHOULDER];
    const rs = landmarks[LM.RIGHT_SHOULDER];
    const lh = landmarks[LM.LEFT_HIP];
    const rh = landmarks[LM.RIGHT_HIP];
    const la = landmarks[LM.LEFT_ANKLE];
    const ra = landmarks[LM.RIGHT_ANKLE];
    const le = landmarks[LM.LEFT_ELBOW];
    const re = landmarks[LM.RIGHT_ELBOW];

    const shoulderMid = midpoint(ls, rs);
    const hipMid = midpoint(lh, rh);
    const ankleY = lmVisible(la) && lmVisible(ra) ? (la.y + ra.y) / 2 : hipMid.y + 0.30;

    return {
      hipMid,
      shoulderMid,
      shoulderWidth: Math.abs(ls.x - rs.x),
      hipWidth: Math.abs(lh.x - rh.x),
      torsoHeight: Math.abs(hipMid.y - shoulderMid.y),
      leftShoulderY: ls.y,
      rightShoulderY: rs.y,
      leftElbowX: lmVisible(le) ? le.x : ls.x,
      rightElbowX: lmVisible(re) ? re.x : rs.x,
      ankleY,
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
  getBaseline(): PallofPressBaseline | null { return this.confirmedBaseline; }
}

/**
 * The shared `CalibrationUpdate.baseline` field is typed as squat's baseline.
 * We adapt — only the fields the play-page actually reads are populated.
 */
function toSquatBaseline(b: PallofPressBaseline): CalibrationBaseline {
  return {
    shoulderMid: b.shoulderMid,
    hipMid: b.hipMid,
    hipWidth: b.hipWidth,
    shoulderWidth: b.shoulderWidth,
    torsoHeight: b.torsoHeight,
    ankleY: b.ankleY,
    feetWidth: b.hipWidth, // approximate — not used by play page for pallof
    feetVsShoulderRatio: b.shoulderWidth > 0 ? b.hipWidth / b.shoulderWidth : 1,
    leftKneeX: b.hipMid.x - b.hipWidth / 4,
    rightKneeX: b.hipMid.x + b.hipWidth / 4,
  };
}
