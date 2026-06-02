/**
 * Side Plank calibration — 4 gates, CHEST facing the camera (the lateral hip
 * sag is only readable in the image plane this way). Gate shape mirrors plank /
 * warrior-3, remapped:
 *
 *   fullBodyVisible → both shoulders + hips + ankles visible
 *   feetWide        → BODY ELONGATED in a line: |Δx| > |Δy| × 1.2 between the
 *                     shoulder-mid and ankle-mid (accepts the diagonal side-plank
 *                     line; rejects a standing/vertical body)
 *   armsOverhead    → STRAIGHT side plank: spine deviation (bend at the hip) is
 *                     low (< 10°) — confirms a real straight side plank, not a
 *                     sagging/collapsed setup
 *   distanceOk      → body length (shoulder-mid → ankle-mid X span) in a band
 *                     (Fix F hysteresis) + MIN_BODY_LENGTH floor (Fix X analog)
 *
 * The body line uses MIDPOINTS of the L/R shoulders/hips/ankles (both sides are
 * visible chest-on), which is more robust than a single side.
 */
import type { PoseLandmarks } from '@/modules/pose/types';
import type { CalibrationUpdate } from '@/modules/squat/types';
import { LM, lmVisible, midpoint } from './geometry';
import type { SidePlankBaseline } from './types';
import { debugLog } from '@/lib/debug';

// Fix G — instant calibration.
const CONFIRM_DURATION_MS = 200;
const BAD_POSTURE_BUFFER_MS = 300;
// Fix J — calibration timeout.
const TIMEOUT_MS = 20_000;

// Body must be elongated (a line, not a vertical/standing body). 2026-05-31
// physical-test fix: relaxed 1.2 → 1.0 ("more horizontal than vertical") so a
// steeper, diagonal side-plank line passes; a vertical/standing body still fails.
const BODY_ELONGATION_RATIO = 1.0;       // |Δx| > |Δy| × this
// Straight side plank at cal: spine bend below this (runtime warns > 12° → gap).
const READY_SPINE_MAX_DEG = 10;

// Fix F — body-length distance hysteresis bands. 2026-05-31 physical-test fix:
// the gate now uses the TRUE (Euclidean) body length, not the X-span, and the
// lower bounds are loosened — a side-lying (diagonal) body spans less of the
// frame than a standing one, and the old X-span read it as "too far".
const MIN_BODY_LENGTH_ENTER = 0.30;
const MAX_BODY_LENGTH_ENTER = 0.95;
const MIN_BODY_LENGTH_EXIT = 0.25;
const MAX_BODY_LENGTH_EXIT = 1.00;
// Fix X analog: hard floor — below this the baseline is degenerate.
const MIN_BODY_LENGTH_RUNTIME = 0.18;

const REQUIRED_LM = [
  LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER,
  LM.LEFT_HIP, LM.RIGHT_HIP,
  LM.LEFT_ANKLE, LM.RIGHT_ANKLE,
];

function spineDeviationDeg(
  shoulderMid: { x: number; y: number },
  hipMid: { x: number; y: number },
  ankleMid: { x: number; y: number },
): number {
  const v1x = hipMid.x - shoulderMid.x, v1y = hipMid.y - shoulderMid.y;
  const v2x = ankleMid.x - hipMid.x, v2y = ankleMid.y - hipMid.y;
  const dot = v1x * v2x + v1y * v2y;
  const cross = Math.abs(v1x * v2y - v1y * v2x);
  return Math.atan2(cross, dot) * (180 / Math.PI);
}

export class SidePlankCalibration {
  private startedAt: number;
  private goodPostureStart = 0;
  private badPostureStart = 0;
  private confirmedBaseline: SidePlankBaseline | null = null;
  private state: 'waiting' | 'good' | 'confirmed' | 'timeout' = 'waiting';
  private lastChecks: CalibrationUpdate['checks'] = {
    fullBodyVisible: false, feetWide: false, armsOverhead: false, distanceOk: false,
  };
  private lastDistanceHint: 'too-close' | 'too-far' | null = null;
  private distInBand = false;

  constructor() {
    this.startedAt = performance.now();
  }

  update(landmarks: PoseLandmarks | null, now: number): CalibrationUpdate {
    if (this.state === 'confirmed') return this.makeUpdate();
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
      if (now - this.goodPostureStart >= CONFIRM_DURATION_MS) {
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
      debugLog('SIDEPLANK', 'CALIB', `${prevState} → ${this.state}`, {
        gates: {
          fullBody: checks.fullBodyVisible,
          elongated: checks.feetWide,
          straight: checks.armsOverhead,
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
    baselineCandidate: SidePlankBaseline | null;
  } {
    const fullBodyVisible = REQUIRED_LM.every((i) => lmVisible(landmarks[i]));
    if (!fullBodyVisible) {
      return {
        checks: { fullBodyVisible: false, feetWide: false, armsOverhead: false, distanceOk: false },
        distanceHint: null,
        baselineCandidate: null,
      };
    }

    const shoulderMid = midpoint(landmarks[LM.LEFT_SHOULDER], landmarks[LM.RIGHT_SHOULDER]);
    const hipMid = midpoint(landmarks[LM.LEFT_HIP], landmarks[LM.RIGHT_HIP]);
    const ankleMid = midpoint(landmarks[LM.LEFT_ANKLE], landmarks[LM.RIGHT_ANKLE]);

    const dx = Math.abs(shoulderMid.x - ankleMid.x);
    const dy = Math.abs(shoulderMid.y - ankleMid.y);
    const elongated = dx > dy * BODY_ELONGATION_RATIO;

    const spineDev = spineDeviationDeg(shoulderMid, hipMid, ankleMid);
    const straight = spineDev < READY_SPINE_MAX_DEG;

    // True (Euclidean) body length — invariant to the side-plank diagonal tilt.
    const bodyLength = Math.hypot(dx, dy);
    const min = this.distInBand ? MIN_BODY_LENGTH_EXIT : MIN_BODY_LENGTH_ENTER;
    const max = this.distInBand ? MAX_BODY_LENGTH_EXIT : MAX_BODY_LENGTH_ENTER;
    let distanceOk = true;
    let distanceHint: 'too-close' | 'too-far' | null = null;
    if (bodyLength < min) { distanceOk = false; distanceHint = 'too-far'; }
    else if (bodyLength > max) { distanceOk = false; distanceHint = 'too-close'; }
    if (bodyLength < MIN_BODY_LENGTH_RUNTIME) { distanceOk = false; distanceHint = 'too-far'; }
    this.distInBand = distanceOk;

    const checks = {
      fullBodyVisible: true,
      feetWide: elongated,       // remap: "wide" slot → "body elongated in a line"
      armsOverhead: straight,    // remap: "overhead" slot → "straight side plank"
      distanceOk,
    };

    if (!checks.feetWide || !checks.armsOverhead || !checks.distanceOk) {
      return { checks, distanceHint, baselineCandidate: null };
    }

    const baseline: SidePlankBaseline = {
      shoulderY: shoulderMid.y,
      hipY: hipMid.y,
      ankleY: ankleMid.y,
      bodyLength,
      initialSpineDeg: spineDev,
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
    };
  }

  isConfirmed(): boolean { return this.state === 'confirmed'; }
  getBaseline(): SidePlankBaseline | null { return this.confirmedBaseline; }
}
