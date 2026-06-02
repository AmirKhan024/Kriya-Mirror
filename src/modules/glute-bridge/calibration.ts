/**
 * GluteBridgeCalibration — side-on camera, user lying on back with knees bent.
 *
 * Gates (reusing the shared CalibrationUpdate.checks shape with remapped meanings):
 *   fullBodyVisible → shoulder + hip + knee + ankle all detectable from the side
 *   feetWide        → kneeBent: knee is raised above hip level (bent ≥ KNEE_ABOVE_HIP_MIN)
 *   armsOverhead    → hipsDown: hips are at floor level (not already raised)
 *   distanceOk      → body horizontal span (shoulder-x to ankle-x) within acceptable range
 */
import type { PoseLandmarks } from '@/modules/pose/types';
import { LM, lmVisible, midpoint, jointMid } from './geometry';
import type { GluteBridgeBaseline } from './types';
import type { CalibrationBaseline, CalibrationState, CalibrationUpdate } from '@/modules/squat/types';
import { debugLog } from '@/lib/debug';

// §3.5: instant calibration — 200 ms hold once all gates are green.
const CONFIRM_DURATION_MS = 200;
const BAD_POSTURE_BUFFER_MS = 300;
const TIMEOUT_MS = 20000;

// Knee must be at least this far above the hip (in normalised Y) for bent-knee check.
// In normalised coords y increases downward, so knee.y < hip.y when knee is raised.
// A value of 0.08 means knee must be 8% of frame height above the hip.
const KNEE_ABOVE_HIP_MIN = 0.08;

// Hip must be within this Y distance of the ankle to count as "hips down" (at rest).
const HIPS_DOWN_TOLERANCE = 0.12;

// Body horizontal span (shoulder.x to ankle.x) acceptable range.
const BODY_SPAN_MIN = 0.28;
const BODY_SPAN_MAX = 0.80;

const REQUIRED_LM = [
  LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER,
  LM.LEFT_HIP, LM.RIGHT_HIP,
  LM.LEFT_KNEE, LM.RIGHT_KNEE,
  LM.LEFT_ANKLE, LM.RIGHT_ANKLE,
];

export class GluteBridgeCalibration {
  private startedAt: number;
  private goodPostureStart = 0;
  private badPostureStart = 0;
  private confirmedBaseline: GluteBridgeBaseline | null = null;
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
      debugLog('GLUTE_BRIDGE', 'CALIB', `${prevState} → ${this.state}`, {
        gates: {
          fullBody: checks.fullBodyVisible,
          kneeBent: checks.feetWide,
          hipsDown: checks.armsOverhead,
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
    const lk = landmarks[LM.LEFT_KNEE];
    const rk = landmarks[LM.RIGHT_KNEE];
    const la = landmarks[LM.LEFT_ANKLE];
    const ra = landmarks[LM.RIGHT_ANKLE];

    const shoulderMid = midpoint(ls, rs);
    const hipMid = midpoint(lh, rh);
    const kneeMid = midpoint(lk, rk);
    const ankleMid = midpoint(la, ra);

    // Gate 2 (feetWide slot): kneeBent — knee must be raised above the hip.
    // In normalised coords, y=0 is top, so knee.y < hip.y means knee is higher in frame.
    const kneeBent = kneeMid.y < hipMid.y - KNEE_ABOVE_HIP_MIN;

    // Gate 3 (armsOverhead slot): hipsDown — hip close to ankle level (near floor).
    const hipsDown = hipMid.y > ankleMid.y - HIPS_DOWN_TOLERANCE;

    // Gate 4: distanceOk — body horizontal span.
    const bodySpan = Math.abs(shoulderMid.x - ankleMid.x);
    let distanceOk = true;
    let distanceHint: 'too-close' | 'too-far' | null = null;
    if (bodySpan < BODY_SPAN_MIN) {
      distanceOk = false;
      distanceHint = 'too-far';
    } else if (bodySpan > BODY_SPAN_MAX) {
      distanceOk = false;
      distanceHint = 'too-close';
    }

    return {
      checks: {
        fullBodyVisible,
        feetWide: kneeBent,      // remap: "wide" slot = kneeBent
        armsOverhead: hipsDown,  // remap: "overhead" slot = hipsDown
        distanceOk,
      },
      distanceHint,
    };
  }

  private captureBaseline(landmarks: PoseLandmarks): GluteBridgeBaseline {
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
    const kneeMid = midpoint(lk, rk);
    const ankleMid = midpoint(la, ra);

    const restingHipY = hipMid.y;
    // kneeAboveHipY: how far (in normalised Y) the knee is above the hip at rest.
    // Since y increases downward, a raised knee has smaller y → restingHipY > kneeMid.y.
    const kneeAboveHipY = restingHipY - kneeMid.y;
    const bodyHorizontalSpan = Math.abs(shoulderMid.x - ankleMid.x);

    return {
      shoulderMid,
      hipMid,
      kneeMid,
      ankleMid,
      restingHipY,
      kneeAboveHipY: Math.max(kneeAboveHipY, 0.05), // guard against degenerate geometry
      bodyHorizontalSpan,
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
  getBaseline(): GluteBridgeBaseline | null { return this.confirmedBaseline; }
}

/**
 * Adapts the glute-bridge baseline to the shared CalibrationBaseline shape the
 * play-page reads. Only the fields the overlay actually uses need real values.
 */
function toSquatBaseline(b: GluteBridgeBaseline): CalibrationBaseline {
  return {
    shoulderMid: b.shoulderMid,
    hipMid: b.hipMid,
    hipWidth: 0,
    shoulderWidth: 0,
    torsoHeight: Math.abs(b.hipMid.y - b.shoulderMid.y),
    ankleY: b.ankleMid.y,
    feetWidth: b.bodyHorizontalSpan,
    feetVsShoulderRatio: 0,
    leftKneeX: b.kneeMid.x,
    rightKneeX: b.kneeMid.x,
  };
}
