/**
 * Warrior III calibration — 4 gates, body SIDE-ON to the camera (the airplane
 * "T" is only readable from the side). Same gate shape as Warrior II / single-
 * leg-stand, remapped:
 *
 *   fullBodyVisible → shoulders + hips + both knees + both ankles
 *   feetWide        → LIFTED LEG READY: one ankle + knee clearly raised
 *                     (knee-confirmed, normalized by torso length) AND the back
 *                     leg lifted toward horizontal (angle < 45° from horizontal)
 *   armsOverhead    → T POSTURE READY: torso hinged toward horizontal
 *                     (pitch < 45°) AND the standing knee straight (< 25° flex)
 *   distanceOk      → torso length in a band (Fix F hysteresis + Fix X floor)
 *
 * All thresholds normalize by TORSO LENGTH (shoulder-mid → hip-mid distance),
 * which is orientation-independent — shoulder width is unreliable side-on.
 * Arms are NOT validated (the forward reach varies; keep robust).
 */
import type { PoseLandmarks } from '@/modules/pose/types';
import type { CalibrationUpdate } from '@/modules/squat/types';
import { LM, lmVisible, midpoint, kneeFlexionDeg, angleFromHorizontalDeg } from './geometry';
import type { WarriorThreeBaseline } from './types';
import { debugLog } from '@/lib/debug';

// Fix G — instant calibration.
const CONFIRM_DURATION_MS = 200;
const BAD_POSTURE_BUFFER_MS = 300;
// Fix J — calibration timeout.
const TIMEOUT_MS = 20_000;

// Lifted-leg detection (knee-confirmed, Fix Y), normalized by torso length.
const LIFTED_ANKLE_RATIO = 0.80;   // |liftedAnkle.y - standingAnkle.y| / torsoLen > this
const LIFTED_KNEE_RATIO = 0.50;    // |liftedKnee.y - standingKnee.y| / torsoLen > this
// Back leg + torso must be hinged toward horizontal to confirm the T.
const BACK_LEG_READY_MAX_DEG = 45; // lifted-leg angle from horizontal < this
const TORSO_READY_MAX_DEG = 45;    // torso pitch from horizontal < this
const STANDING_KNEE_READY_MAX_DEG = 25;

// Fix F — torso-length distance hysteresis bands.
const MIN_TORSO_LEN_ENTER = 0.12;
const MAX_TORSO_LEN_ENTER = 0.28;
const MIN_TORSO_LEN_EXIT = 0.10;
const MAX_TORSO_LEN_EXIT = 0.30;
// Fix X analog: hard floor — below this every torso-normalized threshold collapses.
const MIN_TORSO_LEN_RUNTIME = 0.08;

const REQUIRED_LM = [
  LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER,
  LM.LEFT_HIP, LM.RIGHT_HIP,
  LM.LEFT_KNEE, LM.RIGHT_KNEE,
  LM.LEFT_ANKLE, LM.RIGHT_ANKLE,
];

export class WarriorThreeCalibration {
  private startedAt: number;
  private goodPostureStart = 0;
  private badPostureStart = 0;
  private confirmedBaseline: WarriorThreeBaseline | null = null;
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
      debugLog('WARRIOR3', 'CALIB', `${prevState} → ${this.state}`, {
        gates: {
          fullBody: checks.fullBodyVisible,
          legReady: checks.feetWide,
          tReady: checks.armsOverhead,
          dist: checks.distanceOk,
        },
        distHint: distanceHint,
        liftedSide: baselineCandidate?.liftedSide,
      });
    }

    return this.makeUpdate();
  }

  private checkGates(landmarks: PoseLandmarks): {
    checks: CalibrationUpdate['checks'];
    distanceHint: 'too-close' | 'too-far' | null;
    baselineCandidate: WarriorThreeBaseline | null;
  } {
    const fullBodyVisible = REQUIRED_LM.every((i) => lmVisible(landmarks[i]));
    if (!fullBodyVisible) {
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
    const lk = landmarks[LM.LEFT_KNEE];
    const rk = landmarks[LM.RIGHT_KNEE];
    const la = landmarks[LM.LEFT_ANKLE];
    const ra = landmarks[LM.RIGHT_ANKLE];

    const shoulderMid = midpoint(ls, rs);
    const hipMid = midpoint(lh, rh);
    const torsoLen = Math.hypot(shoulderMid.x - hipMid.x, shoulderMid.y - hipMid.y);

    // Distance gate (Fix F hysteresis + Fix X floor) — on torso length.
    const min = this.distInBand ? MIN_TORSO_LEN_EXIT : MIN_TORSO_LEN_ENTER;
    const max = this.distInBand ? MAX_TORSO_LEN_EXIT : MAX_TORSO_LEN_ENTER;
    let distanceOk = true;
    let distanceHint: 'too-close' | 'too-far' | null = null;
    if (torsoLen < min) { distanceOk = false; distanceHint = 'too-far'; }
    else if (torsoLen > max) { distanceOk = false; distanceHint = 'too-close'; }
    if (torsoLen < MIN_TORSO_LEN_RUNTIME) { distanceOk = false; distanceHint = 'too-far'; }
    this.distInBand = distanceOk;

    const refTorso = Math.max(torsoLen, MIN_TORSO_LEN_RUNTIME);

    // Lifted leg = the higher knee (smaller Y); knee-confirmed.
    const liftedSide: 'left' | 'right' = lk.y < rk.y ? 'left' : 'right';
    const liftedAnkle = liftedSide === 'left' ? la : ra;
    const standingAnkle = liftedSide === 'left' ? ra : la;
    const liftedKnee = liftedSide === 'left' ? lk : rk;
    const standingKnee = liftedSide === 'left' ? rk : lk;
    const standingHip = liftedSide === 'left' ? rh : lh;

    const ankleLifted = (standingAnkle.y - liftedAnkle.y) / refTorso > LIFTED_ANKLE_RATIO;
    const kneeLifted = (standingKnee.y - liftedKnee.y) / refTorso > LIFTED_KNEE_RATIO;

    const backLegAngle = angleFromHorizontalDeg(hipMid, liftedAnkle);
    const torsoPitch = angleFromHorizontalDeg(hipMid, shoulderMid);
    const standingKneeFlex = kneeFlexionDeg(standingHip, standingKnee, standingAnkle);

    const legReady = ankleLifted && kneeLifted && backLegAngle < BACK_LEG_READY_MAX_DEG;
    const tReady = torsoPitch < TORSO_READY_MAX_DEG && standingKneeFlex < STANDING_KNEE_READY_MAX_DEG;

    const checks = {
      fullBodyVisible: true,
      feetWide: legReady,        // remap: "wide" slot → "lifted leg raised"
      armsOverhead: tReady,      // remap: "overhead" slot → "torso hinged into the T"
      distanceOk,
    };

    if (!checks.feetWide || !checks.armsOverhead || !checks.distanceOk) {
      return { checks, distanceHint, baselineCandidate: null };
    }

    const baseline: WarriorThreeBaseline = {
      liftedSide,
      shoulderY: shoulderMid.y,
      torsoLen,
      initialTorsoPitchDeg: torsoPitch,
      initialBackLegAngleDeg: backLegAngle,
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
  getBaseline(): WarriorThreeBaseline | null { return this.confirmedBaseline; }
}
