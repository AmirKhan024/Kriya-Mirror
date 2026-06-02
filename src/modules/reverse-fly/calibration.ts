/**
 * Reverse Fly calibration — 4 gates, front camera, bent-over position.
 *
 * Gate mapping (reuses CalibrationUpdate.checks struct fields):
 *   fullBodyVisible → shoulders, hips, knees, both wrists visible
 *   feetWide        → bent forward at ~45° (shoulderMidY > hipMidY + BENT_OVER_THRESHOLD)
 *   armsOverhead    → arms hanging down (both wrists below shoulders)
 *   distanceOk      → body height in range (hysteresis ENTER/EXIT)
 */
import type { PoseLandmarks } from '@/modules/pose/types';
import type { CalibrationState, CalibrationUpdate, CalibrationBaseline } from '@/modules/squat/types';
import { LM, lmVisible } from './geometry';
import type { ReverseFlyBaseline } from './types';
import { debugLog } from '@/lib/debug';

// Fix G: 200ms confirm debounce
const CONFIRM_DURATION_MS = 200;
const BAD_POSTURE_BUFFER_MS = 300;
const TIMEOUT_MS = 20000;

// Calibration gate thresholds
const BENT_OVER_THRESHOLD = 0.03;      // shoulderMidY > hipMidY + 0.03 (shoulders lower in frame = bent forward)
const ARMS_HANGING_THRESHOLD = 0.06;   // both wrists.y > shoulder.y + 0.06 (wrists below shoulders)

// Fix F: hysteresis — separate ENTER / EXIT thresholds for distance gate
const BODY_HEIGHT_MIN_ENTER = 0.42;
const BODY_HEIGHT_MAX_ENTER = 0.92;
const BODY_HEIGHT_MIN_EXIT  = 0.39;
const BODY_HEIGHT_MAX_EXIT  = 0.94;

const REQUIRED_LM = [
  LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER,
  LM.LEFT_WRIST, LM.RIGHT_WRIST,
  LM.LEFT_HIP, LM.RIGHT_HIP,
  LM.LEFT_KNEE, LM.RIGHT_KNEE,
  LM.LEFT_ANKLE, LM.RIGHT_ANKLE,
];

export class ReverseFlyCalibration {
  private startedAt = -1;
  private goodPostureStart = 0;
  private badPostureStart = 0;
  private confirmedBaseline: ReverseFlyBaseline | null = null;
  private state: CalibrationState = 'waiting';
  private lastChecks: CalibrationUpdate['checks'] = {
    fullBodyVisible: false, feetWide: false, armsOverhead: false, distanceOk: false,
  };
  private lastDistanceHint: 'too-close' | 'too-far' | null = null;
  // Fix F: track in-band state for hysteresis
  private distInBand = false;

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
      debugLog('REVFLY', 'CALIB', `${prevState} → ${this.state}`, {
        gates: {
          fullBody: checks.fullBodyVisible,
          bentForward: checks.feetWide,
          armsHanging: checks.armsOverhead,
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
    baselineCandidate: ReverseFlyBaseline | null;
  } {
    const fullBodyVisible = REQUIRED_LM.every((i) => lmVisible(landmarks[i]));
    if (!fullBodyVisible) {
      this.distInBand = false;
      return {
        checks: { fullBodyVisible: false, feetWide: false, armsOverhead: false, distanceOk: false },
        distanceHint: null,
        baselineCandidate: null,
      };
    }

    const ls = landmarks[LM.LEFT_SHOULDER];
    const rs = landmarks[LM.RIGHT_SHOULDER];
    const lw = landmarks[LM.LEFT_WRIST];
    const rw = landmarks[LM.RIGHT_WRIST];
    const lh = landmarks[LM.LEFT_HIP];
    const rh = landmarks[LM.RIGHT_HIP];
    const la = landmarks[LM.LEFT_ANKLE];
    const ra = landmarks[LM.RIGHT_ANKLE];

    // Bent-forward gate: shoulders lower in frame than hips (Y increases downward)
    const shoulderMidY = (ls.y + rs.y) / 2;
    const hipMidY = (lh.y + rh.y) / 2;
    const bentForward = shoulderMidY > hipMidY + BENT_OVER_THRESHOLD;

    // Arms hanging gate: both wrists below shoulders in screen coords
    const armsHanging = (lw.y > ls.y + ARMS_HANGING_THRESHOLD)
      && (rw.y > rs.y + ARMS_HANGING_THRESHOLD);

    // Body height for distance gate (ankle to shoulder)
    const ankleY = (la.y + ra.y) / 2;
    const shoulderAvgY = shoulderMidY;
    const bodyHeight = Math.abs(ankleY - shoulderAvgY);

    // Fix F: hysteresis
    let distanceOk: boolean;
    if (!this.distInBand) {
      distanceOk = bodyHeight >= BODY_HEIGHT_MIN_ENTER && bodyHeight <= BODY_HEIGHT_MAX_ENTER;
    } else {
      distanceOk = bodyHeight >= BODY_HEIGHT_MIN_EXIT && bodyHeight <= BODY_HEIGHT_MAX_EXIT;
    }
    if (distanceOk) this.distInBand = true;
    else this.distInBand = false;

    // Fix H: distance hint
    let distanceHint: 'too-close' | 'too-far' | null = null;
    if (!distanceOk) {
      distanceHint = bodyHeight < BODY_HEIGHT_MIN_ENTER ? 'too-far' : 'too-close';
    }

    const checks = {
      fullBodyVisible: true,
      feetWide: bentForward,       // remapped: "bent forward"
      armsOverhead: armsHanging,   // remapped: "arms hanging"
      distanceOk,
    };

    if (!checks.feetWide || !checks.armsOverhead || !checks.distanceOk) {
      return { checks, distanceHint, baselineCandidate: null };
    }

    // Capture baseline
    const shoulderMidX = (ls.x + rs.x) / 2;

    const baseline: ReverseFlyBaseline = {
      shoulderMidX,
      shoulderMidY,
      leftShoulderX: ls.x,
      rightShoulderX: rs.x,
      hipMidY,
      bodyHeight,
      wristRestL: lw.y,
      wristRestR: rw.y,
    };

    return { checks, distanceHint, baselineCandidate: baseline };
  }

  private resetProgress(): void {
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
  getBaseline(): ReverseFlyBaseline | null { return this.confirmedBaseline; }
}

/**
 * The shared `CalibrationUpdate.baseline` field is typed as squat's baseline.
 * We adapt — only the fields the play-page actually reads are populated.
 * Mirrors the toSquatBaseline pattern from bird-dog/calibration.ts.
 */
function toSquatBaseline(b: ReverseFlyBaseline): CalibrationBaseline {
  const shoulderMid = { x: b.shoulderMidX, y: b.shoulderMidY };
  const hipMid      = { x: b.shoulderMidX, y: b.hipMidY };
  const torsoHeight = Math.abs(b.hipMidY - b.shoulderMidY);
  const ankleY = b.shoulderMidY + b.bodyHeight;

  return {
    shoulderMid,
    hipMid,
    hipWidth: Math.abs(b.rightShoulderX - b.leftShoulderX),
    shoulderWidth: Math.abs(b.rightShoulderX - b.leftShoulderX),
    torsoHeight,
    ankleY,
    feetWidth: 0,
    feetVsShoulderRatio: 0,
    leftKneeX: 0,
    rightKneeX: 0,
  };
}
