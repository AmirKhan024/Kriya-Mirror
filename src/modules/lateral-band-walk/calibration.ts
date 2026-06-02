/**
 * LateralBandWalkCalibration — 4 gates, front camera, standing position.
 *
 * Gate meanings:
 *   fullBodyVisible → shoulders+hips+knees+ankles+wrists visible
 *   feetWide        → feet hip-width with band (ratio 0.7–1.3× hip-width)
 *   armsOverhead    → hands on hips or at sides (wrists near/below hip Y level)
 *   distanceOk      → body height in frame between 0.45–0.92 with hysteresis (Fix F)
 *
 * Applies: Fix F (distance hysteresis), Fix G (instant 200ms confirm),
 *          Fix H (distance hints), Fix J (20s timeout).
 */
import type { PoseLandmarks } from '@/modules/pose/types';
import type { CalibrationBaseline, CalibrationUpdate } from '@/modules/squat/types';
import { LM, lmVisible, midpoint } from './geometry';
import type { LateralBandWalkBaseline } from './types';
import { debugLog } from '@/lib/debug';

// Fix G: instant confirm (200ms debounce against single-frame noise)
const CONFIRM_DURATION_MS = 200;
const BAD_POSTURE_BUFFER_MS = 300;
// Fix J: calibration timeout
const TIMEOUT_MS = 20000;

// Feet hip-width check: ankle width / hip width should be 0.7–1.3
const MIN_FEET_HIP_RATIO = 0.7;
const MAX_FEET_HIP_RATIO = 1.3;

// BUG-LBW-09: Raised from 0.08 → 0.12. Users naturally shift wrists slightly
// while settling into position; 62ms flicker at 0.08 was resetting calibration progress.
// Arms at sides: wrists within ±0.12 of hip Y level, or below hips
const WRIST_HIP_Y_TOLERANCE = 0.12;

// Fix F: distance gate hysteresis
const BODY_HEIGHT_MIN_ENTER = 0.45;
const BODY_HEIGHT_MIN_EXIT = 0.48;
const BODY_HEIGHT_MAX_ENTER = 0.92;
const BODY_HEIGHT_MAX_EXIT = 0.89;

const REQUIRED_LM = [
  LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER,
  LM.LEFT_HIP, LM.RIGHT_HIP,
  LM.LEFT_KNEE, LM.RIGHT_KNEE,
  LM.LEFT_ANKLE, LM.RIGHT_ANKLE,
  LM.LEFT_WRIST, LM.RIGHT_WRIST,
];

export class LateralBandWalkCalibration {
  private startedAt: number;
  private goodPostureStart = 0;
  private badPostureStart = 0;
  private confirmedBaseline: LateralBandWalkBaseline | null = null;
  private state: 'waiting' | 'good' | 'confirmed' | 'timeout' = 'waiting';
  private lastChecks: CalibrationUpdate['checks'] = {
    fullBodyVisible: false, feetWide: false, armsOverhead: false, distanceOk: false,
  };
  private lastDistanceHint: 'too-close' | 'too-far' | null = null;

  // Fix F: track which side of the hysteresis band we're on
  private distanceWasOk = false;

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
      debugLog('LATERAL-BAND-WALK', 'CALIB', `${prevState} → ${this.state}`, {
        gates: {
          fullBody: checks.fullBodyVisible,
          feetHipWidth: checks.feetWide,
          handsAtSides: checks.armsOverhead,
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
    baselineCandidate: LateralBandWalkBaseline | null;
  } {
    const fullBodyVisible = REQUIRED_LM.every((i) => lmVisible(landmarks[i]));
    if (!fullBodyVisible) {
      this.distanceWasOk = false;
      return {
        checks: { fullBodyVisible: false, feetWide: false, armsOverhead: false, distanceOk: false },
        distanceHint: null,
        baselineCandidate: null,
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

    const shoulderMid = midpoint(ls, rs);
    const hipMid = midpoint(lh, rh);
    const shoulderWidth = Math.abs(ls.x - rs.x);
    const hipWidth = Math.abs(lh.x - rh.x);
    const feetWidth = Math.abs(la.x - ra.x);

    // Feet hip-width check (ratio 0.7–1.3× hip-width)
    const feetHipRatio = hipWidth > 0 ? feetWidth / hipWidth : 1.0;
    const feetWide = feetHipRatio >= MIN_FEET_HIP_RATIO && feetHipRatio <= MAX_FEET_HIP_RATIO;

    // Arms at sides / hands on hips: wrists within ±0.08 of hip Y
    const hipMidY = (lh.y + rh.y) / 2;
    const leftWristOk = Math.abs(lw.y - hipMidY) <= WRIST_HIP_Y_TOLERANCE || lw.y > hipMidY;
    const rightWristOk = Math.abs(rw.y - hipMidY) <= WRIST_HIP_Y_TOLERANCE || rw.y > hipMidY;
    const armsOverhead = leftWristOk && rightWristOk;

    // Fix F: distance gate with hysteresis
    const shoulderY = (ls.y + rs.y) / 2;
    const ankleY = (la.y + ra.y) / 2;
    const bodyHeight = Math.abs(ankleY - shoulderY);

    let distanceOk: boolean;
    let distanceHint: 'too-close' | 'too-far' | null = null;

    if (this.distanceWasOk) {
      // Inside-band: use exit thresholds (wider band — more tolerant)
      if (bodyHeight < BODY_HEIGHT_MIN_EXIT) {
        distanceOk = false;
        distanceHint = 'too-far';
        this.distanceWasOk = false;
      } else if (bodyHeight > BODY_HEIGHT_MAX_EXIT) {
        distanceOk = false;
        distanceHint = 'too-close';
        this.distanceWasOk = false;
      } else {
        distanceOk = true;
      }
    } else {
      // Outside-band: use enter thresholds (stricter)
      if (bodyHeight < BODY_HEIGHT_MIN_ENTER) {
        distanceOk = false;
        distanceHint = 'too-far';
      } else if (bodyHeight > BODY_HEIGHT_MAX_ENTER) {
        distanceOk = false;
        distanceHint = 'too-close';
      } else {
        distanceOk = true;
        this.distanceWasOk = true;
      }
    }

    const checks = {
      fullBodyVisible: true,
      feetWide,          // remap: "wide" slot = feet hip-width with band
      armsOverhead,      // remap: "overhead" slot = hands on hips/at sides
      distanceOk,
    };

    if (!checks.feetWide || !checks.armsOverhead || !checks.distanceOk) {
      return { checks, distanceHint, baselineCandidate: null };
    }

    const torsoHeight = Math.abs(hipMid.y - shoulderMid.y);
    const baseline: LateralBandWalkBaseline = {
      hipMid: { x: (lh.x + rh.x) / 2, y: (lh.y + rh.y) / 2 },
      shoulderMid: { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2 },
      hipWidth,
      shoulderWidth,
      torsoHeight,
      ankleY: (la.y + ra.y) / 2,
      leftHipY: lh.y,
      rightHipY: rh.y,
      frameWidth: 1.0,
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
  getBaseline(): LateralBandWalkBaseline | null { return this.confirmedBaseline; }
}

/** Type-glue: adapt LateralBandWalkBaseline to the shared CalibrationBaseline shape. */
function toSquatBaseline(b: LateralBandWalkBaseline): CalibrationBaseline {
  return {
    shoulderMid: b.shoulderMid,
    hipMid: b.hipMid,
    hipWidth: b.hipWidth,
    shoulderWidth: b.shoulderWidth,
    torsoHeight: b.torsoHeight,
    ankleY: b.ankleY,
    feetWidth: b.hipWidth,   // approximate: feet hip-width = hipWidth
    feetVsShoulderRatio: b.shoulderWidth > 0 ? b.hipWidth / b.shoulderWidth : 0,
    leftKneeX: b.hipMid.x - b.hipWidth * 0.5,
    rightKneeX: b.hipMid.x + b.hipWidth * 0.5,
  };
}
