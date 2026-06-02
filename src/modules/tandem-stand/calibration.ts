/**
 * Tandem Stand calibration — 4 gates per BB5 spec §calibration. Mirrors plank's
 * shape (so the play-page overlay component is shared); field meanings remap:
 *   fullBodyVisible → shoulders+hips+knees+ankles+wrists visible
 *   feetWide        → tandemFeet (ankle xDist small, yDist visible)
 *   armsOverhead    → handsOnHips (wrists at hip height)
 *   distanceOk      → body span in frame
 */
import type { PoseLandmarks } from '@/modules/pose/types';
import type { CalibrationBaseline, CalibrationUpdate } from '@/modules/squat/types';
import { LM, lmVisible, midpoint, dist } from './geometry';
import type { TandemStandBaseline } from './types';
import { debugLog } from '@/lib/debug';

// 2026-05-25 round 5 (§3.5): drop confirmation hold from 2000 → 200ms.
// Once all gates green, calibration confirms "instantly"; the 200ms is a
// single ~6-frame debounce against MediaPipe single-frame noise.
const CONFIRM_DURATION_MS = 200;
const BAD_POSTURE_BUFFER_MS = 300;
const TIMEOUT_MS = 20000;

// BB5 §calibration thresholds (relative to shoulder width)
const TANDEM_ANKLE_X_RATIO = 0.30;    // ankle xDist / shoulderWidth < this
const TANDEM_ANKLE_Y_RATIO = 0.08;    // ankle yDist / shoulderWidth > this (one foot ahead)
const HANDS_ON_HIPS_RATIO = 0.20;     // |wrist.y - hip.y| / trunkLength < this

const BODY_HEIGHT_MIN = 0.45;
const BODY_HEIGHT_MAX = 0.92;

// 2026-05-25 round 13: minimum shoulder width to lock in a usable baseline.
// All hold-detection thresholds normalize by baseline.shoulderWidth, so if
// MediaPipe reports a tiny value (user at the camera edge), the thresholds
// collapse and form warnings fire constantly. Treat as 'too-far'.
const MIN_SHOULDER_WIDTH = 0.08;

const REQUIRED_LM = [
  LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER,
  LM.LEFT_HIP, LM.RIGHT_HIP,
  LM.LEFT_KNEE, LM.RIGHT_KNEE,
  LM.LEFT_ANKLE, LM.RIGHT_ANKLE,
  LM.LEFT_WRIST, LM.RIGHT_WRIST,
];

export class TandemStandCalibration {
  private startedAt: number;
  private goodPostureStart = 0;
  private badPostureStart = 0;
  private confirmedBaselineCalib: TandemStandBaseline | null = null;
  private state: 'waiting' | 'good' | 'confirmed' | 'timeout' = 'waiting';
  private lastChecks: CalibrationUpdate['checks'] = {
    fullBodyVisible: false, feetWide: false, armsOverhead: false, distanceOk: false,
  };
  private lastDistanceHint: 'too-close' | 'too-far' | null = null;

  constructor() {
    this.startedAt = performance.now();
  }

  update(landmarks: PoseLandmarks | null, now: number): CalibrationUpdate {
    if (this.state === 'confirmed') {
      return this.makeUpdate();
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
        this.confirmedBaselineCalib = baselineCandidate;
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
      debugLog('TANDEM', 'CALIB', `${prevState} → ${this.state}`, {
        gates: {
          fullBody: checks.fullBodyVisible,
          tandem: checks.feetWide,
          handsOnHips: checks.armsOverhead,
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
    baselineCandidate: TandemStandBaseline | null;
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
    const la = landmarks[LM.LEFT_ANKLE];
    const ra = landmarks[LM.RIGHT_ANKLE];
    const lw = landmarks[LM.LEFT_WRIST];
    const rw = landmarks[LM.RIGHT_WRIST];

    const shoulderMid = midpoint(ls, rs);
    const hipMid = midpoint(lh, rh);
    const shoulderWidth = Math.abs(ls.x - rs.x);
    const trunkLength = dist(shoulderMid as never, hipMid as never);

    // Tandem feet check (BB5 §calibration)
    const ankleXDist = Math.abs(la.x - ra.x);
    const ankleYDist = Math.abs(la.y - ra.y);
    const tandemFeet = shoulderWidth > 0
      && (ankleXDist / shoulderWidth) < TANDEM_ANKLE_X_RATIO
      && (ankleYDist / shoulderWidth) > TANDEM_ANKLE_Y_RATIO;

    // Hands-on-hips check
    const handsOnHips = trunkLength > 0
      && Math.abs(lw.y - lh.y) / trunkLength < HANDS_ON_HIPS_RATIO
      && Math.abs(rw.y - rh.y) / trunkLength < HANDS_ON_HIPS_RATIO;

    // Distance check (mirrors plank/squat)
    const shoulderY = (ls.y + rs.y) / 2;
    const ankleY = (la.y + ra.y) / 2;
    const bodyHeight = Math.abs(ankleY - shoulderY);
    let distanceOk = true;
    let distanceHint: 'too-close' | 'too-far' | null = null;
    if (bodyHeight < BODY_HEIGHT_MIN || shoulderWidth < MIN_SHOULDER_WIDTH) {
      // 2026-05-25 round 13: shoulderWidth below the floor → treat as too-far.
      distanceOk = false;
      distanceHint = 'too-far';
    } else if (bodyHeight > BODY_HEIGHT_MAX) {
      distanceOk = false;
      distanceHint = 'too-close';
    }

    const checks = {
      fullBodyVisible: true,
      feetWide: tandemFeet,         // remap: "wide" slot now means "tandem (heel-to-toe)"
      armsOverhead: handsOnHips,    // remap: "overhead" slot now means "hands on hips"
      distanceOk,
    };

    if (!checks.feetWide || !checks.armsOverhead || !checks.distanceOk) {
      return { checks, distanceHint, baselineCandidate: null };
    }

    const baseline: TandemStandBaseline = {
      // CoM x/y here is a placeholder — the ENGINE captures the real baseline
      // from the first 10 valid frames of the HOLD (per BB5 callout). We store
      // calibration-time CoM so the engine has something to seed with.
      comX: hipMid.x * 0.6 + shoulderMid.x * 0.4,
      comY: hipMid.y * 0.6 + shoulderMid.y * 0.4,
      shoulderWidth,
      trunkLength,
      ankleXDistance: ankleXDist,
      shoulderY,
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
      baseline: this.confirmedBaselineCalib ? toSquatBaseline(this.confirmedBaselineCalib) : undefined,
    };
  }

  isConfirmed(): boolean { return this.state === 'confirmed'; }
  getBaseline(): TandemStandBaseline | null { return this.confirmedBaselineCalib; }
}

/** Type-glue: shared `CalibrationUpdate.baseline` is typed as squat's. We
 *  populate only the fields the play-page actually reads. */
function toSquatBaseline(b: TandemStandBaseline): CalibrationBaseline {
  return {
    shoulderMid: { x: b.comX, y: b.shoulderY },
    hipMid: { x: b.comX, y: b.shoulderY + b.trunkLength },
    hipWidth: 0,
    shoulderWidth: b.shoulderWidth,
    torsoHeight: b.trunkLength,
    ankleY: b.shoulderY + b.trunkLength + 0.3,    // approximate
    feetWidth: b.ankleXDistance,
    feetVsShoulderRatio: b.shoulderWidth > 0 ? b.ankleXDistance / b.shoulderWidth : 0,
    leftKneeX: b.comX,
    rightKneeX: b.comX,
  };
}
