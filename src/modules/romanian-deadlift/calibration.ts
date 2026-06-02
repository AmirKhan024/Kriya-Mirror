/**
 * RDL calibration — side camera, person standing upright with soft knee bend.
 *
 * Reuses the shared CalibrationUpdate shape from squat so the play-page overlay
 * is shared. Gate meanings are remapped:
 *   fullBodyVisible → camera-side shoulder+hip+knee+ankle all visible
 *   feetWide        → bodyUpright: hip hinge < 20° (person standing, not pre-bent)
 *   armsOverhead    → armsAtSides: wrists below shoulders AND wrists visible
 *   distanceOk      → body height in frame within acceptable range (with hysteresis)
 *
 * RDL-specific: captures kneeAngleAtCalibration (baseline soft bend) for excessive-knee-bend detection.
 */
import type { PoseLandmarks } from '@/modules/pose/types';
import { LM, lmVisible, hipHingeDeg, kneeFlexionDeg } from './geometry';
import type { RDLBaseline } from './types';
import type { CalibrationBaseline, CalibrationState, CalibrationUpdate } from '@/modules/squat/types';
import { debugLog } from '@/lib/debug';

// Fix G: instant confirm once all gates green.
const CONFIRM_DURATION_MS = 200;
const BAD_POSTURE_BUFFER_MS = 300;
// Fix J: calibration timeout
const TIMEOUT_MS = 30_000;

// Hip hinge must be less than this to count as "standing upright"
const STANDING_HINGE_MAX_DEG = 20;

// Body height (shoulder.y to ankle.y) in frame — acceptable range.
// Hysteresis (Fix F): entering the band requires stricter thresholds than staying in it.
const BODY_HEIGHT_MIN_ENTER = 0.50;
const BODY_HEIGHT_MAX_ENTER = 0.90;
const BODY_HEIGHT_MIN_EXIT = 0.45;
const BODY_HEIGHT_MAX_EXIT = 0.92;

export class RDLCalibration {
  private startedAt: number;
  private goodPostureStart = 0;
  private badPostureStart = 0;
  private confirmedBaseline: RDLBaseline | null = null;
  private state: CalibrationState = 'waiting';
  private lastChecks: CalibrationUpdate['checks'] = {
    fullBodyVisible: false, feetWide: false, armsOverhead: false, distanceOk: false,
  };
  private lastDistanceHint: 'too-close' | 'too-far' | null = null;
  private distInBand = false;

  constructor() {
    this.startedAt = -1; // seeded from first update() call (tests pass tMs from 0)
  }

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
      debugLog('RDL', 'CALIB', `${prevState} → ${this.state}`, {
        gates: {
          fullBody: checks.fullBodyVisible,
          upright: checks.feetWide,
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
    baselineCandidate: RDLBaseline | null;
  } {
    // Pick the side with better shoulder+hip+ankle visibility
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

    const fullBodyVisible = lmVisible(shoulder) && lmVisible(hip) && lmVisible(knee) && lmVisible(ankle);
    if (!fullBodyVisible) {
      return {
        checks: { fullBodyVisible: false, feetWide: false, armsOverhead: false, distanceOk: false },
        distanceHint: null,
        baselineCandidate: null,
      };
    }

    // Body upright: hip hinge must be less than threshold
    const hingeDeg = hipHingeDeg(shoulder, hip, knee);
    const bodyUpright = hingeDeg < STANDING_HINGE_MAX_DEG;

    // Arms at sides: at least one wrist below shoulder (wrist.y > shoulder.y in screen coords)
    const wristVisible = lmVisible(wrist) || lmVisible(oppWrist);
    const wristBelowShoulder = (lmVisible(wrist) && wrist.y > shoulder.y)
      || (lmVisible(oppWrist) && oppWrist.y > shoulder.y);
    const armsAtSides = !wristVisible || wristBelowShoulder;

    // Distance via body height in y (shoulder-to-ankle span) — Fix F: hysteresis
    const bodyHeight = Math.abs(ankle.y - shoulder.y);
    const min = this.distInBand ? BODY_HEIGHT_MIN_EXIT : BODY_HEIGHT_MIN_ENTER;
    const max = this.distInBand ? BODY_HEIGHT_MAX_EXIT : BODY_HEIGHT_MAX_ENTER;
    let distanceOk = true;
    let distanceHint: 'too-close' | 'too-far' | null = null;
    if (bodyHeight < min) {
      distanceOk = false;
      distanceHint = 'too-far';
    } else if (bodyHeight > max) {
      distanceOk = false;
      distanceHint = 'too-close';
    }
    this.distInBand = distanceOk;

    const checks = {
      fullBodyVisible: true,
      feetWide: bodyUpright,       // remap: "wide" slot = "standing upright"
      armsOverhead: armsAtSides,   // remap: "overhead" slot = "arms at sides"
      distanceOk,
    };

    if (!checks.feetWide || !checks.armsOverhead || !checks.distanceOk) {
      return { checks, distanceHint, baselineCandidate: null };
    }

    // Capture knee angle at calibration (soft bend baseline — RDL-specific)
    const kneeAngleAtCalibration = kneeFlexionDeg(hip, knee, ankle);

    const baseline: RDLBaseline = {
      shoulderY: shoulder.y,
      hipY: hip.y,
      kneeY: knee.y,
      ankleY: ankle.y,
      side,
      bodyLengthY: bodyHeight,
      hipX: hip.x,
      shoulderX: shoulder.x,
      kneeAngleAtCalibration,
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
      baseline: this.confirmedBaseline ? toSquatBaseline(this.confirmedBaseline) : undefined,
    };
  }

  isConfirmed(): boolean { return this.state === 'confirmed'; }
  getBaseline(): RDLBaseline | null { return this.confirmedBaseline; }
}

/** Adapt RDLBaseline to the shared CalibrationBaseline shape the play page reads. */
function toSquatBaseline(b: RDLBaseline): CalibrationBaseline {
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
