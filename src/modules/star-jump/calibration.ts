/**
 * Star Jump calibration — 4 gates mirroring bicep-curl's structure, remapped:
 *   fullBodyVisible → shoulders + elbows + wrists + hips + ankles visible
 *   feetWide        → feetAtSides (feet ≤ 1.20× shoulder width — start position)
 *   armsOverhead    → armsAtSides (wrists clearly BELOW shoulders — rest position)
 *   distanceOk      → body span in frame
 *
 * Confirms instantly (200ms) once all 4 gates pass.
 */
import type { PoseLandmarks } from '@/modules/pose/types';
import type { CalibrationState, CalibrationUpdate } from '@/modules/squat/types';
import { LM, lmVisible, midpoint } from './geometry';
import type { StarJumpBaseline } from './types';
import { debugLog } from '@/lib/debug';

// 2026-05-25 (§3.5): instant confirmation once all gates green; 200ms is a
// single ~6-frame debounce against MediaPipe single-frame noise.
const CONFIRM_DURATION_MS = 200;
const BAD_POSTURE_BUFFER_MS = 300;
const TIMEOUT_MS = 20000;

const MAX_FEET_RATIO = 1.20;               // feet ≤ 1.20× shoulder width at start position
const ARMS_AT_SIDES_MARGIN = 0.08;        // wristMidY must exceed shoulderMidY + this

const BODY_HEIGHT_MIN = 0.45;
const BODY_HEIGHT_MAX = 0.92;

// Distance-gate hysteresis (Fix F): separate enter / exit thresholds to
// prevent the "good" state flapping when the user is near the boundary.
const BODY_HEIGHT_ENTER_MIN = BODY_HEIGHT_MIN + 0.03;
const BODY_HEIGHT_ENTER_MAX = BODY_HEIGHT_MAX - 0.03;

const REQUIRED_LM = [
  LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER,
  LM.LEFT_ELBOW,    LM.RIGHT_ELBOW,
  LM.LEFT_WRIST,    LM.RIGHT_WRIST,
  LM.LEFT_HIP,      LM.RIGHT_HIP,
  LM.LEFT_ANKLE,    LM.RIGHT_ANKLE,
];

export class StarJumpCalibration {
  private startedAt: number;
  private goodPostureStart = 0;
  private badPostureStart = 0;
  private confirmedBaseline: StarJumpBaseline | null = null;
  private state: CalibrationState = 'waiting';
  private lastChecks: CalibrationUpdate['checks'] = {
    fullBodyVisible: false, feetWide: false, armsOverhead: false, distanceOk: false,
  };
  private lastDistanceHint: 'too-close' | 'too-far' | null = null;
  private distanceOkLatched = false;
  private seededAt = false;
  private lastNow = 0;

  constructor() {
    this.startedAt = 0; // seeded from first update() call
  }

  update(landmarks: PoseLandmarks | null, now: number): CalibrationUpdate {
    // Seed startedAt from first real timestamp (supports test harness using tMs)
    if (!this.seededAt) {
      this.startedAt = now;
      this.seededAt = true;
    }
    this.lastNow = now;

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
      this.distanceOkLatched = false;
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
      debugLog('STAR_JUMP', 'CALIB', `${prevState} → ${this.state}`, {
        gates: {
          fullBody: checks.fullBodyVisible,
          feetAtSides: checks.feetWide,
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
    baselineCandidate: StarJumpBaseline | null;
  } {
    const fullBodyVisible = REQUIRED_LM.every((i) => lmVisible(landmarks[i]));
    if (!fullBodyVisible) {
      this.distanceOkLatched = false;
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

    const shoulderWidth = Math.abs(ls.x - rs.x);
    const feetWidth = Math.abs(la.x - ra.x);
    const feetAtSides = shoulderWidth > 0 && feetWidth / shoulderWidth <= MAX_FEET_RATIO;

    // Arms at sides: wrist midpoint must be clearly BELOW shoulder level
    const shoulderMidY = (ls.y + rs.y) / 2;
    const wristMidY = (lw.y + rw.y) / 2;
    const armsAtSides = wristMidY > shoulderMidY + ARMS_AT_SIDES_MARGIN;

    // Distance gate with hysteresis (Fix F)
    const shoulderMidY2 = shoulderMidY;
    const ankleY = (la.y + ra.y) / 2;
    const bodyHeight = Math.abs(ankleY - shoulderMidY2);
    let distanceOk: boolean;
    let distanceHint: 'too-close' | 'too-far' | null = null;
    if (this.distanceOkLatched) {
      distanceOk = bodyHeight >= BODY_HEIGHT_MIN && bodyHeight <= BODY_HEIGHT_MAX;
    } else {
      distanceOk = bodyHeight >= BODY_HEIGHT_ENTER_MIN && bodyHeight <= BODY_HEIGHT_ENTER_MAX;
    }
    if (!distanceOk) {
      this.distanceOkLatched = false;
      if (bodyHeight < BODY_HEIGHT_MIN) distanceHint = 'too-far';
      else if (bodyHeight > BODY_HEIGHT_MAX) distanceHint = 'too-close';
    } else {
      this.distanceOkLatched = true;
    }

    const checks = {
      fullBodyVisible: true,
      feetWide: feetAtSides,
      armsOverhead: armsAtSides,
      distanceOk,
    };

    if (!checks.feetWide || !checks.armsOverhead || !checks.distanceOk) {
      return { checks, distanceHint, baselineCandidate: null };
    }

    const shoulderMid = midpoint(ls, rs);
    const hipMid = midpoint(lh, rh);
    const baseline: StarJumpBaseline = {
      shoulderMid,
      hipMid,
      hipWidth: Math.abs(lh.x - rh.x),
      shoulderWidth,
      torsoHeight: Math.abs(hipMid.y - shoulderMid.y),
      ankleY,
      feetWidth,
      feetVsShoulderRatio: shoulderWidth > 0 ? feetWidth / shoulderWidth : 0,
      leftKneeX: landmarks[LM.LEFT_KNEE]?.x ?? lh.x,
      rightKneeX: landmarks[LM.RIGHT_KNEE]?.x ?? rh.x,
      shoulderMidX: shoulderMid.x,
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
        ? Math.min(CONFIRM_DURATION_MS, this.lastNow - this.goodPostureStart)
        : 0,
      checks: this.lastChecks,
      distanceHint: this.lastDistanceHint,
      baseline: this.confirmedBaseline ?? undefined,
    };
  }

  isConfirmed(): boolean { return this.state === 'confirmed'; }
  getBaseline(): StarJumpBaseline | null { return this.confirmedBaseline; }
}
