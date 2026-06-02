/**
 * Pull-up calibration — 4 gates. Front camera. User hangs from bar at dead hang.
 *
 *   fullBodyVisible  → shoulders, elbows, wrists, hips, ankles all visible
 *   feetWide         → repurposed: wrists above shoulder level (confirms bar hang)
 *   armsOverhead     → both elbows flex < 25° (dead hang = arms fully extended)
 *   distanceOk       → body span (shoulder-to-ankle) in range
 */
import type { PoseLandmarks } from '@/modules/pose/types';
import type { CalibrationState, CalibrationUpdate } from '@/modules/squat/types';
import { LM, lmVisible, midpoint, elbowFlexionDeg } from './geometry';
import type { PullUpBaseline } from './types';
import { debugLog } from '@/lib/debug';

// 2026-05-25 round 5 (§3.5): 200 ms instant-confirm debounce.
const CONFIRM_DURATION_MS = 200;
const BAD_POSTURE_BUFFER_MS = 300;
const TIMEOUT_MS = 30000;

const ARMS_EXTENDED_FLEX_MAX = 25;   // elbows < 25° = dead hang
const WRISTS_ABOVE_OFFSET = 0.08;    // wrist.y must be < shoulder.y - 0.08

// Distance gate: shoulder-to-ankle body height
const BODY_HEIGHT_MIN = 0.40;
const BODY_HEIGHT_MAX = 0.90;
// Hysteresis to prevent distance gate oscillation (Fix F from bilal_prompt §5)
const BODY_HEIGHT_MIN_EXIT = BODY_HEIGHT_MIN - 0.02;
const BODY_HEIGHT_MAX_EXIT = BODY_HEIGHT_MAX + 0.02;

const REQUIRED_LM = [
  LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER,
  LM.LEFT_ELBOW, LM.RIGHT_ELBOW,
  LM.LEFT_WRIST, LM.RIGHT_WRIST,
  LM.LEFT_HIP, LM.RIGHT_HIP,
  LM.LEFT_ANKLE, LM.RIGHT_ANKLE,
];

export class PullUpCalibration {
  private startedAt: number;
  private goodPostureStart = 0;
  private badPostureStart = 0;
  private confirmedBaseline: PullUpBaseline | null = null;
  private state: CalibrationState = 'waiting';
  private lastChecks: CalibrationUpdate['checks'] = {
    fullBodyVisible: false, feetWide: false, armsOverhead: false, distanceOk: false,
  };
  private lastDistanceHint: 'too-close' | 'too-far' | null = null;
  // Hysteresis state — tracks whether we were last "in range" for distance
  private distanceInRange = false;

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
        baseline: this.confirmedBaseline ?? undefined,
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
      debugLog('PULLUP', 'CALIB', `${prevState} → ${this.state}`, {
        gates: {
          fullBody: checks.fullBodyVisible,
          wristsAboveShoulder: checks.feetWide,
          armsExtended: checks.armsOverhead,
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
    baselineCandidate: PullUpBaseline | null;
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
    const le = landmarks[LM.LEFT_ELBOW];
    const re = landmarks[LM.RIGHT_ELBOW];
    const lw = landmarks[LM.LEFT_WRIST];
    const rw = landmarks[LM.RIGHT_WRIST];
    const lh = landmarks[LM.LEFT_HIP];
    const rh = landmarks[LM.RIGHT_HIP];
    const la = landmarks[LM.LEFT_ANKLE];
    const ra = landmarks[LM.RIGHT_ANKLE];

    const shoulderMidY = (ls.y + rs.y) / 2;
    const wristMidY = (lw.y + rw.y) / 2;

    // feetWide slot → wristsAboveShoulder: wrists must be clearly above shoulders
    // (confirms user is hanging from a bar, not just standing with arms at sides)
    const wristsAboveShoulder = wristMidY < shoulderMidY - WRISTS_ABOVE_OFFSET;

    // armsOverhead slot → armsExtended: both elbows at dead-hang flex < 25°
    const leftFlex = elbowFlexionDeg(ls, le, lw);
    const rightFlex = elbowFlexionDeg(rs, re, rw);
    const armsExtended = leftFlex < ARMS_EXTENDED_FLEX_MAX && rightFlex < ARMS_EXTENDED_FLEX_MAX;

    // Distance gate with hysteresis (Fix F)
    const shoulderY = shoulderMidY;
    const ankleY = (la.y + ra.y) / 2;
    const bodyHeight = Math.abs(ankleY - shoulderY);

    let distanceOk: boolean;
    let distanceHint: 'too-close' | 'too-far' | null = null;

    if (this.distanceInRange) {
      // Already in range — use exit thresholds (wider, to prevent jitter)
      if (bodyHeight < BODY_HEIGHT_MIN_EXIT) {
        distanceOk = false;
        distanceHint = 'too-far';
        this.distanceInRange = false;
      } else if (bodyHeight > BODY_HEIGHT_MAX_EXIT) {
        distanceOk = false;
        distanceHint = 'too-close';
        this.distanceInRange = false;
      } else {
        distanceOk = true;
      }
    } else {
      // Not in range — use enter thresholds
      if (bodyHeight < BODY_HEIGHT_MIN) {
        distanceOk = false;
        distanceHint = 'too-far';
      } else if (bodyHeight > BODY_HEIGHT_MAX) {
        distanceOk = false;
        distanceHint = 'too-close';
      } else {
        distanceOk = true;
        this.distanceInRange = true;
      }
    }

    const checks = {
      fullBodyVisible: true,
      feetWide: wristsAboveShoulder,     // remap: "wide" slot → "wrists above"
      armsOverhead: armsExtended,        // remap: "overhead" slot → "arms extended"
      distanceOk,
    };

    if (!checks.feetWide || !checks.armsOverhead || !checks.distanceOk) {
      return { checks, distanceHint, baselineCandidate: null };
    }

    const shoulderMid = midpoint(ls, rs);
    const hipMid = midpoint(lh, rh);
    const earMidY = (
      (landmarks[LM.LEFT_EAR]?.y ?? shoulderMidY - 0.12) +
      (landmarks[LM.RIGHT_EAR]?.y ?? shoulderMidY - 0.12)
    ) / 2;

    const baseline: PullUpBaseline = {
      shoulderMid,
      hipMid,
      hipWidth: Math.abs(lh.x - rh.x),
      shoulderWidth: Math.abs(ls.x - rs.x),
      torsoHeight: Math.abs(hipMid.y - shoulderMid.y),
      ankleY: (la.y + ra.y) / 2,
      feetWidth: Math.abs(la.x - ra.x),
      feetVsShoulderRatio: Math.abs(ls.x - rs.x) > 0
        ? Math.abs(la.x - ra.x) / Math.abs(ls.x - rs.x) : 0,
      leftKneeX: landmarks[LM.LEFT_KNEE]?.x ?? lh.x,
      rightKneeX: landmarks[LM.RIGHT_KNEE]?.x ?? rh.x,
      wristMidY,
      earShoulderGap: shoulderMidY - earMidY,
      shoulderMidX: shoulderMid.x,
      hipMidX: hipMid.x,
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
      baseline: this.confirmedBaseline ?? undefined,
    };
  }

  isConfirmed(): boolean { return this.state === 'confirmed'; }
  getBaseline(): PullUpBaseline | null { return this.confirmedBaseline; }
}
