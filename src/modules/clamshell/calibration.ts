/**
 * ClamshellCalibration — side-on camera, user lying on side with knees bent.
 *
 * Gates (using the shared CalibrationUpdate.checks shape with remapped meanings):
 *   fullBodyVisible → both hips + both knees visible with confidence > 0.5
 *   feetWide        → sideLying: one hip clearly above the other (person IS lying on side)
 *   armsOverhead    → feetTogether: ankles close in Y (feet stacked/together)
 *   distanceOk      → body horizontal span is within acceptable range
 */
import type { PoseLandmarks } from '@/modules/pose/types';
import { LM, lmVisible, midpoint, detectBottomSide } from './geometry';
import type { ClamshellBaseline } from './types';
import type { CalibrationBaseline, CalibrationState, CalibrationUpdate } from '@/modules/squat/types';
import { debugLog } from '@/lib/debug';

// §3.5: instant calibration — 200 ms hold once all gates are green.
const CONFIRM_DURATION_MS = 200;
const BAD_POSTURE_BUFFER_MS = 300;
const TIMEOUT_MS = 30000;

// Body horizontal span acceptable range.
const BODY_SPAN_MIN = 0.30;
const BODY_SPAN_MAX = 1.0;

const REQUIRED_LM = [
  LM.LEFT_HIP, LM.RIGHT_HIP,
  LM.LEFT_KNEE, LM.RIGHT_KNEE,
  LM.LEFT_ANKLE, LM.RIGHT_ANKLE,
];

export class ClamshellCalibration {
  private startedAt: number;
  private goodPostureStart = 0;
  private badPostureStart = 0;
  private confirmedBaseline: ClamshellBaseline | null = null;
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
      debugLog('CLAMSHELL', 'CALIB', `${prevState} → ${this.state}`, {
        gates: {
          fullBody: checks.fullBodyVisible,
          sideLying: checks.feetWide,
          feetTogether: checks.armsOverhead,
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

    const lh = landmarks[LM.LEFT_HIP];
    const rh = landmarks[LM.RIGHT_HIP];
    const la = landmarks[LM.LEFT_ANKLE];
    const ra = landmarks[LM.RIGHT_ANKLE];
    const ls = landmarks[LM.LEFT_SHOULDER];
    const rs = landmarks[LM.RIGHT_SHOULDER];

    const hipGap = Math.abs(lh.y - rh.y);

    // Gate 2 (feetWide slot): sideLying — one hip clearly above the other.
    // A person lying on their side will have measurably different hip Y values.
    // Threshold: hipGap > 3% of frame height (0.03 in normalized coords).
    const sideLying = hipGap > 0.03;

    // Gate 3 (armsOverhead slot): feetTogether — ankles close in Y.
    // When lying on side with feet stacked, both ankles are at similar Y.
    // Threshold: hip * 1.5 allows for typical bent-knee geometry where
    // ankle separation mirrors knee separation (about 80% of hipGap).
    const ankleYDiff = Math.abs(la.y - ra.y);
    const feetTogether = ankleYDiff < hipGap * 1.5;

    // Gate 4: distanceOk — body horizontal span.
    // Person lying sideways fills the frame horizontally.
    // Use left-ankle to right-shoulder as body length approximation.
    const bodySpanX = Math.abs(la.x - rs.x);
    let distanceOk = true;
    let distanceHint: 'too-close' | 'too-far' | null = null;
    if (bodySpanX < BODY_SPAN_MIN) {
      distanceOk = false;
      distanceHint = 'too-far';
    } else if (bodySpanX > BODY_SPAN_MAX) {
      distanceOk = false;
      distanceHint = 'too-close';
    }

    // Also try right-ankle to left-shoulder (person might be lying the other way)
    if (!distanceOk) {
      const bodySpanX2 = Math.abs(ra.x - ls.x);
      if (bodySpanX2 >= BODY_SPAN_MIN && bodySpanX2 <= BODY_SPAN_MAX) {
        distanceOk = true;
        distanceHint = null;
      }
    }

    return {
      checks: {
        fullBodyVisible,
        feetWide: sideLying,       // remap: "wide" slot = sideLying
        armsOverhead: feetTogether, // remap: "overhead" slot = feetTogether
        distanceOk,
      },
      distanceHint,
    };
  }

  private captureBaseline(landmarks: PoseLandmarks): ClamshellBaseline {
    const ls = landmarks[LM.LEFT_SHOULDER];
    const rs = landmarks[LM.RIGHT_SHOULDER];
    const lh = landmarks[LM.LEFT_HIP];
    const rh = landmarks[LM.RIGHT_HIP];
    const lk = landmarks[LM.LEFT_KNEE];
    const rk = landmarks[LM.RIGHT_KNEE];
    const la = landmarks[LM.LEFT_ANKLE];
    const ra = landmarks[LM.RIGHT_ANKLE];

    const shoulderMid = midpoint(ls, rs);
    const hipMid = midpoint(lh, rh);

    const bottomSide = detectBottomSide(lh, rh);
    const topSide: 'left' | 'right' = bottomSide === 'left' ? 'right' : 'left';

    const bottomHipY = bottomSide === 'left' ? lh.y : rh.y;
    const topHipY = bottomSide === 'left' ? rh.y : lh.y;
    const bottomKneeY = bottomSide === 'left' ? lk.y : rk.y;
    const topKneeY = bottomSide === 'left' ? rk.y : lk.y;

    const hipGap = Math.abs(bottomHipY - topHipY);
    // At rest, bottom knee has higher Y (lower in frame) than top knee.
    // kneeGapBaseline = bottomKneeY - topKneeY (positive at rest).
    const kneeGapBaseline = bottomKneeY - topKneeY;

    const ankleY = (la.y + ra.y) / 2;
    const feetWidth = Math.abs(la.x - ra.x);

    return {
      hipMid,
      shoulderMid,
      hipWidth: Math.abs(lh.x - rh.x),
      shoulderWidth: Math.abs(ls.x - rs.x),
      torsoHeight: Math.abs(hipMid.y - shoulderMid.y),
      ankleY,
      feetWidth,
      leftKneeX: lk.x,
      rightKneeX: rk.x,
      bottomSide,
      topSide,
      bottomHipY,
      topHipY,
      bottomKneeY,
      topKneeY,
      hipGap: Math.max(hipGap, 0.02), // guard against degenerate geometry
      kneeGapBaseline,
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
  getBaseline(): ClamshellBaseline | null { return this.confirmedBaseline; }
}

/**
 * Adapts the clamshell baseline to the shared CalibrationBaseline shape the
 * play-page reads. Only the fields the overlay actually uses need real values.
 */
function toSquatBaseline(b: ClamshellBaseline): CalibrationBaseline {
  return {
    shoulderMid: b.shoulderMid,
    hipMid: b.hipMid,
    hipWidth: b.hipWidth,
    shoulderWidth: b.shoulderWidth,
    torsoHeight: b.torsoHeight,
    ankleY: b.ankleY,
    feetWidth: b.feetWidth,
    feetVsShoulderRatio: 0,
    leftKneeX: b.leftKneeX,
    rightKneeX: b.rightKneeX,
  };
}
