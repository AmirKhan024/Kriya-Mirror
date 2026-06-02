/**
 * Boat Pose calibration — 4 gates, body SIDE-ON to the camera (the seated "V"
 * is a sagittal-plane shape, only readable from the side). Gate shape mirrors
 * warrior-3, remapped:
 *
 *   fullBodyVisible → shoulders + hips + knees + ankles
 *   feetWide        → LEGS LIFTED into the V: leg angle from horizontal ≥ 25°
 *   armsOverhead    → CHEST LIFTED / leaning back: torso angle from horizontal ≥ 30°
 *   distanceOk      → torso length in a band (Fix F hysteresis) + MIN_TORSO_LEN floor (Fix X)
 *
 * All thresholds normalize by TORSO LENGTH (shoulder-mid → hip-mid distance),
 * which is orientation-independent. Arms are NOT validated (the forward reach
 * varies; keep robust). Segments use MIDPOINTS of the L/R landmarks.
 */
import type { PoseLandmarks } from '@/modules/pose/types';
import type { CalibrationUpdate } from '@/modules/squat/types';
import { LM, lmVisible, midpoint, angleFromHorizontalDeg } from './geometry';
import type { BoatPoseBaseline } from './types';
import { debugLog } from '@/lib/debug';

// Fix G — instant calibration.
const CONFIRM_DURATION_MS = 200;
const BAD_POSTURE_BUFFER_MS = 300;
// Fix J — calibration timeout.
const TIMEOUT_MS = 20_000;

// The V is "ready" when both the legs and the torso are lifted toward horizontal.
const READY_LEG_MIN_DEG = 25;     // leg angle from horizontal at cal
const READY_TORSO_MIN_DEG = 30;   // torso angle from horizontal at cal

// Fix F — torso-length distance hysteresis bands.
const MIN_TORSO_LEN_ENTER = 0.12;
const MAX_TORSO_LEN_ENTER = 0.30;
const MIN_TORSO_LEN_EXIT = 0.10;
const MAX_TORSO_LEN_EXIT = 0.32;
// Fix X analog: hard floor.
const MIN_TORSO_LEN_RUNTIME = 0.08;

const REQUIRED_LM = [
  LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER,
  LM.LEFT_HIP, LM.RIGHT_HIP,
  LM.LEFT_KNEE, LM.RIGHT_KNEE,
  LM.LEFT_ANKLE, LM.RIGHT_ANKLE,
];

export class BoatPoseCalibration {
  private startedAt: number;
  private goodPostureStart = 0;
  private badPostureStart = 0;
  private confirmedBaseline: BoatPoseBaseline | null = null;
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
      debugLog('BOAT', 'CALIB', `${prevState} → ${this.state}`, {
        gates: {
          fullBody: checks.fullBodyVisible,
          legsUp: checks.feetWide,
          chestUp: checks.armsOverhead,
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
    baselineCandidate: BoatPoseBaseline | null;
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

    const torsoLen = Math.hypot(shoulderMid.x - hipMid.x, shoulderMid.y - hipMid.y);

    const min = this.distInBand ? MIN_TORSO_LEN_EXIT : MIN_TORSO_LEN_ENTER;
    const max = this.distInBand ? MAX_TORSO_LEN_EXIT : MAX_TORSO_LEN_ENTER;
    let distanceOk = true;
    let distanceHint: 'too-close' | 'too-far' | null = null;
    if (torsoLen < min) { distanceOk = false; distanceHint = 'too-far'; }
    else if (torsoLen > max) { distanceOk = false; distanceHint = 'too-close'; }
    if (torsoLen < MIN_TORSO_LEN_RUNTIME) { distanceOk = false; distanceHint = 'too-far'; }
    this.distInBand = distanceOk;

    const torsoAngle = angleFromHorizontalDeg(hipMid, shoulderMid);
    const legAngle = angleFromHorizontalDeg(hipMid, ankleMid);

    const legsUp = legAngle >= READY_LEG_MIN_DEG;
    const chestUp = torsoAngle >= READY_TORSO_MIN_DEG;

    const checks = {
      fullBodyVisible: true,
      feetWide: legsUp,        // remap: "wide" slot → "legs lifted into the V"
      armsOverhead: chestUp,   // remap: "overhead" slot → "chest lifted, leaning back"
      distanceOk,
    };

    if (!checks.feetWide || !checks.armsOverhead || !checks.distanceOk) {
      return { checks, distanceHint, baselineCandidate: null };
    }

    const baseline: BoatPoseBaseline = {
      torsoLen,
      initialTorsoAngleDeg: torsoAngle,
      initialLegAngleDeg: legAngle,
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
  getBaseline(): BoatPoseBaseline | null { return this.confirmedBaseline; }
}
