/**
 * JumpSquat calibration — front camera, person standing upright in jump stance.
 *
 * Gate meanings (reuses CalibrationUpdate shape from squat):
 *   fullBodyVisible → all bilateral shoulder+hip+knee+ankle visible
 *   feetWide        → feet roughly shoulder-width (0.80–1.60 ratio)
 *   armsOverhead    → armsAtSides: wrists below shoulders
 *   distanceOk      → body height in acceptable range (with hysteresis)
 */
import type { PoseLandmarks } from '@/modules/pose/types';
import { LM, lmVisible, midpoint, kneeFlexionDeg } from './geometry';
import type { JumpSquatBaseline } from './types';
import type { CalibrationBaseline, CalibrationState, CalibrationUpdate } from '@/modules/squat/types';
import { debugLog } from '@/lib/debug';

// Fix G: instant confirm once all gates green
const CONFIRM_DURATION_MS = 200;
const BAD_POSTURE_BUFFER_MS = 300;
// Fix J: 30s timeout
const TIMEOUT_MS = 30_000;

// Body height (shoulder.y to ankle.y) — acceptable range.
// Fix F: Hysteresis — entering the band requires stricter thresholds than staying in it.
const BODY_HEIGHT_MIN_ENTER = 0.50;
const BODY_HEIGHT_MAX_ENTER = 0.90;
const BODY_HEIGHT_MIN_EXIT = 0.45;
const BODY_HEIGHT_MAX_EXIT = 0.92;

// Feet width vs shoulder width — acceptable ratio for jump stance
const FEET_WIDTH_MIN_RATIO = 0.80;   // feet at least 80% of shoulder width
const FEET_WIDTH_MAX_RATIO = 1.60;   // not too wide

export class JumpSquatCalibration {
  private startedAt = -1;
  private goodPostureStart = 0;
  private badPostureStart = 0;
  private confirmedBaseline: JumpSquatBaseline | null = null;
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
      debugLog('JUMPSQUAT', 'CALIB', `${prevState} → ${this.state}`, {
        gates: {
          fullBody: checks.fullBodyVisible,
          feetWidth: checks.feetWide,
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
    baselineCandidate: JumpSquatBaseline | null;
  } {
    const ls = landmarks[LM.LEFT_SHOULDER];
    const rs = landmarks[LM.RIGHT_SHOULDER];
    const lh = landmarks[LM.LEFT_HIP];
    const rh = landmarks[LM.RIGHT_HIP];
    const lk = landmarks[LM.LEFT_KNEE];
    const rk = landmarks[LM.RIGHT_KNEE];
    const la = landmarks[LM.LEFT_ANKLE];
    const ra = landmarks[LM.RIGHT_ANKLE];
    const lw = landmarks[LM.LEFT_WRIST];
    const rw = landmarks[LM.RIGHT_WRIST];

    // Gate 1: fullBodyVisible — all bilateral landmarks present
    const fullBodyVisible =
      lmVisible(ls) && lmVisible(rs) &&
      lmVisible(lh) && lmVisible(rh) &&
      lmVisible(lk) && lmVisible(rk) &&
      lmVisible(la) && lmVisible(ra);

    if (!fullBodyVisible) {
      return {
        checks: { fullBodyVisible: false, feetWide: false, armsOverhead: false, distanceOk: false },
        distanceHint: null,
        baselineCandidate: null,
      };
    }

    const shoulderMid = midpoint(ls, rs);
    const hipMid = midpoint(lh, rh);
    const ankleMid = midpoint(la, ra);
    const shoulderWidth = Math.abs(ls.x - rs.x);
    const feetWidth = Math.abs(la.x - ra.x);

    // Gate 2: feetAtJumpWidth — feet between 0.80–1.60 × shoulder width
    const feetRatio = shoulderWidth > 0 ? feetWidth / shoulderWidth : 1.0;
    const feetAtJumpWidth = feetRatio >= FEET_WIDTH_MIN_RATIO && feetRatio <= FEET_WIDTH_MAX_RATIO;

    // Gate 3: armsAtSides — wrists visible and below shoulder level
    const lwVisible = lmVisible(lw);
    const rwVisible = lmVisible(rw);
    const wristBelowShoulder =
      (!lwVisible || lw.y > ls.y) &&
      (!rwVisible || rw.y > rs.y);
    const armsAtSides = wristBelowShoulder;

    // Gate 4: distance via body height (shoulder to ankle Y span)
    const bodyHeight = Math.abs(ankleMid.y - shoulderMid.y);
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
      feetWide: feetAtJumpWidth,
      armsOverhead: armsAtSides,
      distanceOk,
    };

    if (!checks.feetWide || !checks.armsOverhead || !checks.distanceOk) {
      return { checks, distanceHint, baselineCandidate: null };
    }

    const kneeAngleL = kneeFlexionDeg(lh, lk, la);
    const kneeAngleR = kneeFlexionDeg(rh, rk, ra);
    const avgKneeAngle = (kneeAngleL + kneeAngleR) / 2;

    const baseline: JumpSquatBaseline = {
      hipY: hipMid.y,
      shoulderY: shoulderMid.y,
      ankleY: ankleMid.y,
      bodyLengthY: bodyHeight,
      shoulderMid,
      shoulderWidth,
      feetWidth,
      hipMidX: hipMid.x,
    };

    void avgKneeAngle; // captured for future use
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
  getBaseline(): JumpSquatBaseline | null { return this.confirmedBaseline; }
}

/** Adapt JumpSquatBaseline to the shared CalibrationBaseline shape the play page reads. */
export function toSquatBaseline(b: JumpSquatBaseline): CalibrationBaseline {
  return {
    shoulderMid: b.shoulderMid,
    hipMid: { x: b.hipMidX, y: b.hipY },
    shoulderWidth: b.shoulderWidth,
    hipWidth: b.feetWidth,
    torsoHeight: Math.abs(b.hipY - b.shoulderY),
    ankleY: b.ankleY,
    feetWidth: b.feetWidth,
    feetVsShoulderRatio: b.shoulderWidth > 0 ? b.feetWidth / b.shoulderWidth : 1,
    leftKneeX: b.hipMidX - b.shoulderWidth * 0.3,
    rightKneeX: b.hipMidX + b.shoulderWidth * 0.3,
  };
}
