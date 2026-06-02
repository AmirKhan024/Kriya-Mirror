/**
 * Seated March calibration — 4 gates, front-camera, remapped to the seated
 * rest position (sitting tall, both feet flat, thighs level):
 *   fullBodyVisible → shoulders + hips + knees visible
 *   feetWide        → SEATED (knees near hip height — thighs roughly level)
 *   armsOverhead    → both knees down / symmetric at rest (clean per-side baseline)
 *   distanceOk      → torso height in frame + shoulderWidth ≥ MIN_SHOULDER_WIDTH (Fix X)
 *
 * "Do not confuse a chair and a person": MediaPipe never lands points on the
 * chair, and the SEATED gate rejects a standing person (whose knees sit far
 * below the hips) and an empty chair (no landmarks at all). The engine therefore
 * only ever activates for a clearly seated human. Ankles are intentionally NOT
 * required — seated, the feet sit near/under the chair and foreshorten; the
 * reliable signal is the knee, which rides well above the seat.
 *
 * Baseline captures per-side knee Y references — the alternating state machine
 * computes lift against each side's own baseline so MediaPipe's L vs R bias
 * doesn't permanently favor one side.
 */
import type { PoseLandmarks } from '@/modules/pose/types';
import type { CalibrationState, CalibrationUpdate } from '@/modules/squat/types';
import { LM, lmVisible, midpoint } from './geometry';
import type { SeatedMarchBaseline } from './types';
import { debugLog } from '@/lib/debug';

const CONFIRM_DURATION_MS = 200;          // Fix G
const BAD_POSTURE_BUFFER_MS = 300;        // Fix F
const TIMEOUT_MS = 20000;                 // Fix J

// Fix X cal side
const MIN_SHOULDER_WIDTH = 0.08;

// SEATED: knees sit near hip height (thighs level). A standing person's knees
// are ~1.2–1.5 shoulder-widths below the hips → fails this gate.
const SEATED_KNEE_BELOW_HIP_MAX_RATIO = 0.7;
// Both knees down / symmetric at rest → a clean per-side baseline.
const KNEE_SYMMETRY_MAX_RATIO = 0.5;

const TORSO_HEIGHT_MIN = 0.12;
const TORSO_HEIGHT_MAX = 0.45;

const REQUIRED_LM = [
  LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER,
  LM.LEFT_HIP, LM.RIGHT_HIP,
  LM.LEFT_KNEE, LM.RIGHT_KNEE,
];

export class SeatedMarchCalibration {
  private startedAt: number;
  private goodPostureStart = 0;
  private badPostureStart = 0;
  private confirmedBaseline: SeatedMarchBaseline | null = null;
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
      debugLog('MARCH', 'CALIB', `${prevState} → ${this.state}`, {
        gates: {
          fullBody: checks.fullBodyVisible,
          seated: checks.feetWide,
          kneesDown: checks.armsOverhead,
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
    baselineCandidate: SeatedMarchBaseline | null;
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

    const shoulderWidth = Math.abs(ls.x - rs.x);
    const w = Math.max(shoulderWidth, 1e-6);
    const hipMidY = (lh.y + rh.y) / 2;
    const avgKneeY = (lk.y + rk.y) / 2;

    // SEATED: knees near hip height (thighs level). Positive ratio = knees below
    // hips. A standing person's knees are far below the hips → fails.
    const kneeBelowHipRatio = (avgKneeY - hipMidY) / w;
    const seated = kneeBelowHipRatio <= SEATED_KNEE_BELOW_HIP_MAX_RATIO;

    // Both knees down / symmetric at rest → clean per-side baseline.
    const kneeSymmetry = Math.abs(lk.y - rk.y) / w;
    const kneesDown = kneeSymmetry < KNEE_SYMMETRY_MAX_RATIO;

    // Distance: torso height in frame + Fix X shoulder-width floor.
    const shoulderMidY = (ls.y + rs.y) / 2;
    const torsoHeight = Math.abs(hipMidY - shoulderMidY);
    let distanceOk = true;
    let distanceHint: 'too-close' | 'too-far' | null = null;
    if (torsoHeight < TORSO_HEIGHT_MIN) {
      distanceOk = false;
      distanceHint = 'too-far';
    } else if (torsoHeight > TORSO_HEIGHT_MAX) {
      distanceOk = false;
      distanceHint = 'too-close';
    } else if (shoulderWidth < MIN_SHOULDER_WIDTH) {
      // Fix X cal side: torso span looks fine but shoulderWidth is degenerate.
      distanceOk = false;
      distanceHint = 'too-far';
    }

    const checks = {
      fullBodyVisible: true,
      feetWide: seated,        // remap: "wide" slot → "seated (thighs level)"
      armsOverhead: kneesDown, // remap: "overhead" slot → "both knees down at rest"
      distanceOk,
    };

    if (!checks.feetWide || !checks.armsOverhead || !checks.distanceOk) {
      return { checks, distanceHint, baselineCandidate: null };
    }

    const shoulderMid = midpoint(ls, rs);
    const hipMid = midpoint(lh, rh);
    const baseline: SeatedMarchBaseline = {
      shoulderMid,
      hipMid,
      hipWidth: Math.abs(lh.x - rh.x),
      shoulderWidth,
      torsoHeight,
      ankleY: avgKneeY,        // ankles not gated when seated; knee Y is the reference
      feetWidth: 0,
      feetVsShoulderRatio: 0,
      leftKneeX: lk.x,
      rightKneeX: rk.x,
      baselineLeftKneeY: lk.y,
      baselineRightKneeY: rk.y,
      shoulderMidX: shoulderMid.x,
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
  getBaseline(): SeatedMarchBaseline | null { return this.confirmedBaseline; }
}
