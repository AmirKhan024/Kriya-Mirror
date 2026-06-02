/**
 * Mountain Pose calibration — 4 gates, front-facing camera. Same gate shape
 * as tandem-stand/SLS but with field remappings for Tadasana:
 *   fullBodyVisible → shoulders + hips + knees + ankles + wrists visible
 *   feetWide        → feetCloseTogether (ankle X distance < 0.50 × shoulderWidth)
 *                     — Tadasana uses feet together or hip-width
 *   armsOverhead    → wrists clearly above shoulders (the user reaches up)
 *   distanceOk      → body height in frame + Fix X shoulderWidth floor
 */
import type { PoseLandmarks } from '@/modules/pose/types';
import type { CalibrationState, CalibrationUpdate } from '@/modules/squat/types';
import { LM, lmVisible } from './geometry';
import type { MountainPoseBaseline } from './types';
import { debugLog } from '@/lib/debug';

// Fix G — instant calibration.
const CONFIRM_DURATION_MS = 200;
const BAD_POSTURE_BUFFER_MS = 300;
// Fix J — calibration timeout.
const TIMEOUT_MS = 20_000;

// Feet positioning: ≤ 0.50 × shoulderWidth means feet are at hip-width or
// narrower (Tadasana stance). Tandem-stand uses 0.45 to require feet aligned;
// Mountain Pose is more permissive.
const MAX_FEET_VS_SHOULDER_RATIO = 0.50;

// Arms overhead — both wrists must clearly sit above both shoulders.
// (Round 19 added this; round 20 dropped the calf-raise / heels-lifted layer.)
const ARMS_OVERHEAD_Y_MARGIN = 0.05;

const BODY_HEIGHT_MIN = 0.45;
const BODY_HEIGHT_MAX = 0.92;

// Fix X — narrow shoulderWidth = degenerate baseline → too-far.
const MIN_SHOULDER_WIDTH = 0.08;

const REQUIRED_LM = [
  LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER,
  LM.LEFT_HIP, LM.RIGHT_HIP,
  LM.LEFT_KNEE, LM.RIGHT_KNEE,
  LM.LEFT_ANKLE, LM.RIGHT_ANKLE,
  LM.LEFT_WRIST, LM.RIGHT_WRIST,
];

export class MountainPoseCalibration {
  private startedAt: number;
  private goodPostureStart = 0;
  private badPostureStart = 0;
  private confirmedBaseline: MountainPoseBaseline | null = null;
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
      debugLog('MOUNTAIN', 'CALIB', `${prevState} → ${this.state}`, {
        gates: {
          fullBody: checks.fullBodyVisible,
          feetTogether: checks.feetWide,
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
    baselineCandidate: MountainPoseBaseline | null;
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

    const shoulderWidth = Math.abs(ls.x - rs.x);

    // Feet close together: ankle X distance ≤ MAX_FEET_VS_SHOULDER_RATIO × shoulder
    const ankleXDist = Math.abs(la.x - ra.x);
    const feetCloseTogether = shoulderWidth > 0
      && (ankleXDist / shoulderWidth) <= MAX_FEET_VS_SHOULDER_RATIO;

    // Arms overhead: both wrists clearly ABOVE both shoulders (Y inverted).
    // 2026-05-28 round 20: this was previously combined with a heels-lifted
    // (calf-raise) check; the heels layer was dropped per user direction.
    const armsOverhead = lw.y < ls.y - ARMS_OVERHEAD_Y_MARGIN
                      && rw.y < rs.y - ARMS_OVERHEAD_Y_MARGIN;

    // Distance gate
    const shoulderY = (ls.y + rs.y) / 2;
    const ankleYAvg = (la.y + ra.y) / 2;
    const bodyHeight = Math.abs(ankleYAvg - shoulderY);
    let distanceOk = true;
    let distanceHint: 'too-close' | 'too-far' | null = null;
    if (bodyHeight < BODY_HEIGHT_MIN || shoulderWidth < MIN_SHOULDER_WIDTH) {
      // Fix X — narrow shoulder = too-far.
      distanceOk = false;
      distanceHint = 'too-far';
    } else if (bodyHeight > BODY_HEIGHT_MAX) {
      distanceOk = false;
      distanceHint = 'too-close';
    }

    const checks = {
      fullBodyVisible: true,
      feetWide: feetCloseTogether,   // remap: "wide" slot → "close together"
      armsOverhead,                  // arms reach overhead (round 20: standalone, no heels)
      distanceOk,
    };

    if (!checks.feetWide || !checks.armsOverhead || !checks.distanceOk) {
      return { checks, distanceHint, baselineCandidate: null };
    }

    const baseline: MountainPoseBaseline = {
      comX: (lh.x + rh.x) / 2 * 0.6 + (ls.x + rs.x) / 2 * 0.4,
      comY: (lh.y + rh.y) / 2 * 0.6 + (ls.y + rs.y) / 2 * 0.4,
      shoulderWidth,
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
    };
  }

  isConfirmed(): boolean { return this.state === 'confirmed'; }
  getBaseline(): MountainPoseBaseline | null { return this.confirmedBaseline; }
}
