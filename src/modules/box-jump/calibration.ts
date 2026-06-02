/**
 * BoxJump calibration — side camera, person standing upright in jump stance.
 *
 * Reuses the shared CalibrationUpdate shape from squat so the play-page overlay
 * is shared. Gate meanings are remapped:
 *   fullBodyVisible → camera-side shoulder+hip+knee+ankle all visible
 *   feetWide        → sideProfile: shoulder depth (x-span) is narrow (person turned 90°)
 *   armsOverhead    → armsAtSides: wrists below shoulders AND wrists visible
 *   distanceOk      → body height in frame within acceptable range (with hysteresis)
 */
import type { PoseLandmarks } from '@/modules/pose/types';
import { LM, lmVisible, kneeFlexionDeg } from './geometry';
import type { BoxJumpBaseline } from './types';
import type { CalibrationBaseline, CalibrationState, CalibrationUpdate } from '@/modules/squat/types';
import { debugLog } from '@/lib/debug';

// Fix G: instant confirm once all gates green
const CONFIRM_DURATION_MS = 200;
const BAD_POSTURE_BUFFER_MS = 300;
// Fix J: 30s timeout
const TIMEOUT_MS = 30_000;

// Body height (shoulder.y to ankle.y) in frame — acceptable range.
// Fix F: Hysteresis — entering the band requires stricter thresholds than staying in it.
const BODY_HEIGHT_MIN_ENTER = 0.50;
const BODY_HEIGHT_MAX_ENTER = 0.90;
const BODY_HEIGHT_MIN_EXIT = 0.45;
const BODY_HEIGHT_MAX_EXIT = 0.92;

// For side-profile check: shoulder width on side camera should be narrow
// (user turned 90° — only one shoulder visible prominently)
const SIDE_PROFILE_SHOULDER_MAX = 0.15;

export class BoxJumpCalibration {
  private startedAt = -1;
  private goodPostureStart = 0;
  private badPostureStart = 0;
  private confirmedBaseline: BoxJumpBaseline | null = null;
  private state: CalibrationState = 'waiting';
  private lastChecks: CalibrationUpdate['checks'] = {
    fullBodyVisible: false, feetWide: false, armsOverhead: false, distanceOk: false,
  };
  private lastDistanceHint: 'too-close' | 'too-far' | null = null;
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
      debugLog('BOXJUMP', 'CALIB', `${prevState} → ${this.state}`, {
        gates: {
          fullBody: checks.fullBodyVisible,
          sideProfile: checks.feetWide,
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
    baselineCandidate: BoxJumpBaseline | null;
  } {
    // Pick the side with better shoulder+hip+knee+ankle visibility (side-camera pattern)
    const ls = landmarks[LM.LEFT_SHOULDER];
    const rs = landmarks[LM.RIGHT_SHOULDER];
    const lh = landmarks[LM.LEFT_HIP];
    const rh = landmarks[LM.RIGHT_HIP];
    const la = landmarks[LM.LEFT_ANKLE];
    const ra = landmarks[LM.RIGHT_ANKLE];
    const lk = landmarks[LM.LEFT_KNEE];
    const rk = landmarks[LM.RIGHT_KNEE];
    const lw = landmarks[LM.LEFT_WRIST];
    const rw = landmarks[LM.RIGHT_WRIST];

    const leftScore = (ls?.visibility ?? 0) + (lh?.visibility ?? 0) + (la?.visibility ?? 0);
    const rightScore = (rs?.visibility ?? 0) + (rh?.visibility ?? 0) + (ra?.visibility ?? 0);
    const side: 'left' | 'right' = leftScore >= rightScore ? 'left' : 'right';

    const shoulder = side === 'left' ? ls : rs;
    const hip = side === 'left' ? lh : rh;
    const knee = side === 'left' ? lk : rk;
    const ankle = side === 'left' ? la : ra;
    const wrist = side === 'left' ? lw : rw;
    const oppWrist = side === 'left' ? rw : lw;

    // Gate 1: fullBodyVisible — camera-side shoulder+hip+knee+ankle all visible
    const fullBodyVisible = lmVisible(shoulder) && lmVisible(hip) && lmVisible(knee) && lmVisible(ankle);
    if (!fullBodyVisible) {
      return {
        checks: { fullBodyVisible: false, feetWide: false, armsOverhead: false, distanceOk: false },
        distanceHint: null,
        baselineCandidate: null,
      };
    }

    // Gate 2: sideProfile — shoulder x-span is narrow (user turned 90° to camera)
    // When side-on, both shoulders are nearly at the same x, so their absolute x-spread is small
    const shoulderXSpan = Math.abs(ls.x - rs.x);
    const sideProfile = shoulderXSpan < SIDE_PROFILE_SHOULDER_MAX;

    // Gate 3: armsAtSides — at least one wrist below shoulder (arms not raised)
    const wristVisible = lmVisible(wrist) || lmVisible(oppWrist);
    const wristBelowShoulder = (lmVisible(wrist) && wrist.y > shoulder.y)
      || (lmVisible(oppWrist) && oppWrist.y > shoulder.y);
    const armsAtSides = !wristVisible || wristBelowShoulder;

    // Gate 4: distance via body height in y (shoulder-to-ankle span)
    const bodyHeight = Math.abs(ankle.y - shoulder.y);
    // Fix F: hysteresis
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

    const checks = {
      fullBodyVisible: true,
      feetWide: sideProfile,       // remap: "wide" slot = "side profile"
      armsOverhead: armsAtSides,   // remap: "overhead" slot = "arms at sides"
      distanceOk,
    };

    // Fix H: distanceHint emitted on every update via makeUpdate()
    if (!checks.feetWide || !checks.armsOverhead || !checks.distanceOk) {
      return { checks, distanceHint, baselineCandidate: null };
    }

    const kneeAngle = kneeFlexionDeg(hip, knee, ankle);

    const baseline: BoxJumpBaseline = {
      shoulderY: shoulder.y,
      hipY: hip.y,
      kneeY: knee.y,
      ankleY: ankle.y,
      side,
      bodyLengthY: bodyHeight,
      hipX: hip.x,
      shoulderX: shoulder.x,
      kneeAngleAtCalibration: kneeAngle,
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
  getBaseline(): BoxJumpBaseline | null { return this.confirmedBaseline; }
}

/** Adapt BoxJumpBaseline to the shared CalibrationBaseline shape the play page reads. */
export function toSquatBaseline(b: BoxJumpBaseline): CalibrationBaseline {
  return {
    shoulderMid: { x: b.shoulderX, y: b.shoulderY },
    hipMid: { x: b.hipX, y: b.hipY },
    shoulderWidth: 0,
    hipWidth: 0,
    torsoHeight: Math.abs(b.hipY - b.shoulderY),
    ankleY: b.ankleY,
    feetWidth: 0,
    feetVsShoulderRatio: 0,
    leftKneeX: b.hipX,
    rightKneeX: b.hipX,
  };
}
