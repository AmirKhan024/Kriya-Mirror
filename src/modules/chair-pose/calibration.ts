/**
 * Chair Pose calibration — 4 gates, side-facing camera.
 *
 * Mirrors plank's gate-shape (the play-page overlay reads `checks.fullBodyVisible
 * / feetWide / armsOverhead / distanceOk`). Field meanings remapped:
 *   fullBodyVisible → side shoulder+hip+knee+ankle all visible
 *   feetWide        → knees bent (kneeFlexionDeg > MIN_KNEE_FLEX_FOR_HOLD)
 *   armsOverhead    → arms extended forward (wrist ahead of shoulder X) OR
 *                     overhead (wrist Y ≤ shoulder Y)
 *   distanceOk      → body height (ankle-Y minus shoulder-Y) within band, with
 *                     hysteresis (Fix F) and a "too-far" floor (Fix X analog
 *                     for side-on pose — shoulder-width is naturally tiny when
 *                     rotated 90° to the camera, so bodyHeight is the right
 *                     reference, not shoulderWidth).
 */
import type { PoseLandmarks, NormalizedLandmark } from '@/modules/pose/types';
import type { CalibrationUpdate } from '@/modules/squat/types';
import { LM, lmVisible, kneeFlexionDeg, trunkLeanDeg, midpoint } from '@/modules/squat/geometry';
import type { ChairPoseBaseline } from './types';
import { debugLog } from '@/lib/debug';

// Fix G: instant calibration — confirms ~6 frames after all gates go green.
const CONFIRM_DURATION_MS = 200;
const BAD_POSTURE_BUFFER_MS = 300;
// Fix J: calibration timeout.
const TIMEOUT_MS = 20_000;

// "Knees bent into chair" gate. Below this knee-flex angle = user is still
// standing or only soft-bend — not yet a chair pose. Conservative threshold
// so users don't have to sink to a perfect 90° to confirm.
const MIN_KNEE_FLEX_FOR_HOLD = 30;
// Above this at cal-time = too deep / squatting; reject because the user is
// probably going to overextend and immediately collapse the hold.
const MAX_KNEE_FLEX_FOR_HOLD = 140;

// Trunk should be reasonably upright at calibration (not bent over).
const MAX_TRUNK_LEAN_AT_CAL_DEG = 45;

// Fix F: distance hysteresis. Side-facing pose uses body HEIGHT (Y span from
// ankle to shoulder) as the distance reference — body-X-span is small because
// the user is rotated. Bands are slightly narrower than plank's X-span bands
// because vertical framing in a portrait phone view tolerates less variance.
const MIN_BODY_HEIGHT_ENTER = 0.45;
const MAX_BODY_HEIGHT_ENTER = 0.88;
const MIN_BODY_HEIGHT_EXIT = 0.40;   // ~11% looser on the "too-far" side
const MAX_BODY_HEIGHT_EXIT = 0.93;   // ~5% looser on the "too-close" side

// Fix X analog for side-on pose: bodyHeight floor below which baseline would
// be degenerate (every distance-normalized threshold collapses to noise).
// MUST be ≤ MIN_BODY_HEIGHT_ENTER so the gate logic catches it via the band
// check; kept here as an explicit named constant for the test's clarity.
const MIN_BODY_HEIGHT_RUNTIME = 0.30;

export class ChairPoseCalibration {
  private startedAt: number;
  private goodPostureStart = 0;
  private badPostureStart = 0;
  private confirmedBaseline: ChairPoseBaseline | null = null;
  private state: 'waiting' | 'good' | 'confirmed' | 'timeout' = 'waiting';
  private lastChecks: CalibrationUpdate['checks'] = {
    fullBodyVisible: false, feetWide: false, armsOverhead: false, distanceOk: false,
  };
  private lastDistanceHint: 'too-close' | 'too-far' | null = null;
  // Fix F: persisted band-membership so hysteresis applies across frames.
  private distInBand = false;

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
      debugLog('CHAIR', 'CALIB', `${prevState} → ${this.state}`, {
        gates: {
          sideProfile: checks.fullBodyVisible,
          kneesBent: checks.feetWide,
          armsReady: checks.armsOverhead,
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
    baselineCandidate: ChairPoseBaseline | null;
  } {
    const ls = landmarks[LM.LEFT_SHOULDER];
    const rs = landmarks[LM.RIGHT_SHOULDER];
    const lh = landmarks[LM.LEFT_HIP];
    const rh = landmarks[LM.RIGHT_HIP];
    const lk = landmarks[LM.LEFT_KNEE];
    const rk = landmarks[LM.RIGHT_KNEE];
    const la = landmarks[LM.LEFT_ANKLE];
    const ra = landmarks[LM.RIGHT_ANKLE];
    const lw = landmarks[LM.LEFT_WRIST];
    const rw = landmarks[LM.RIGHT_WRIST];

    // Pick the side with better visibility on the side-on critical chain
    const leftScore = (ls?.visibility ?? 0) + (lh?.visibility ?? 0)
      + (lk?.visibility ?? 0) + (la?.visibility ?? 0);
    const rightScore = (rs?.visibility ?? 0) + (rh?.visibility ?? 0)
      + (rk?.visibility ?? 0) + (ra?.visibility ?? 0);
    const side: 'left' | 'right' = leftScore >= rightScore ? 'left' : 'right';

    const shoulder = side === 'left' ? ls : rs;
    const hip = side === 'left' ? lh : rh;
    const knee = side === 'left' ? lk : rk;
    const ankle = side === 'left' ? la : ra;
    const wrist = side === 'left' ? lw : rw;

    const fullBodyVisible = lmVisible(shoulder) && lmVisible(hip) && lmVisible(knee) && lmVisible(ankle);
    if (!fullBodyVisible) {
      return {
        checks: { fullBodyVisible: false, feetWide: false, armsOverhead: false, distanceOk: false },
        distanceHint: null,
        baselineCandidate: null,
      };
    }

    // Knee flexion at calibration. squat/geometry: 0° = straight, ~90° = parallel.
    const kneeFlex = kneeFlexionDeg(hip, knee, ankle);
    const kneesBent = kneeFlex >= MIN_KNEE_FLEX_FOR_HOLD && kneeFlex <= MAX_KNEE_FLEX_FOR_HOLD;

    // Arms ready: either reaching forward (wrist X clearly ahead of shoulder X
    // on the forward direction the user is facing) OR overhead (wrist Y at or
    // above shoulder Y). We accept either to be generous about user style.
    let armsReady = false;
    if (lmVisible(wrist)) {
      const reachingForward = Math.abs(wrist.x - shoulder.x) > 0.08;
      const armsOverhead = wrist.y <= shoulder.y + 0.02;
      armsReady = reachingForward || armsOverhead;
    } else {
      // If side-on wrist isn't visible (occluded by torso), accept by default —
      // arms aren't critical for the engine logic, only for posture confirmation.
      armsReady = true;
    }

    // Distance via body height in Y, with hysteresis (Fix F + H).
    const bodyHeight = Math.abs(ankle.y - shoulder.y);
    const min = this.distInBand ? MIN_BODY_HEIGHT_EXIT : MIN_BODY_HEIGHT_ENTER;
    const max = this.distInBand ? MAX_BODY_HEIGHT_EXIT : MAX_BODY_HEIGHT_ENTER;
    let distanceOk = true;
    let distanceHint: 'too-close' | 'too-far' | null = null;
    if (bodyHeight < min) {
      distanceOk = false;
      distanceHint = 'too-far';
    } else if (bodyHeight > max) {
      distanceOk = false;
      distanceHint = 'too-close';
    }
    // Fix X analog for side-on: explicit floor reject. Even if the band would
    // technically pass at the edge (e.g. someone tunes the exit band wider in
    // future), bodyHeight below MIN_BODY_HEIGHT_RUNTIME means the baseline is
    // unreliable — surface as too-far so the user steps closer.
    if (bodyHeight < MIN_BODY_HEIGHT_RUNTIME) {
      distanceOk = false;
      distanceHint = 'too-far';
    }
    this.distInBand = distanceOk;

    const checks = {
      fullBodyVisible: true,
      feetWide: kneesBent,           // remap: knees bent into chair
      armsOverhead: armsReady,       // remap: arms reaching forward or overhead
      distanceOk,
    };

    if (!checks.feetWide || !checks.armsOverhead || !checks.distanceOk) {
      return { checks, distanceHint, baselineCandidate: null };
    }

    // Initial trunk lean — sanity check; if the user is bowing forward at cal,
    // reject so we don't lock that as the baseline.
    const trunkDeg = trunkLeanDeg(
      midpointOf(shoulder, shoulder),  // single-side; midpoint of itself is itself
      midpointOf(hip, hip),
    );
    if (trunkDeg > MAX_TRUNK_LEAN_AT_CAL_DEG) {
      return {
        checks: { ...checks, feetWide: false }, // surface as "posture not ready"
        distanceHint,
        baselineCandidate: null,
      };
    }

    const baseline: ChairPoseBaseline = {
      side,
      shoulderY: shoulder.y,
      hipY: hip.y,
      kneeY: knee.y,
      ankleY: ankle.y,
      bodyHeight,
      initialKneeFlexionDeg: kneeFlex,
      initialTrunkLeanDeg: trunkDeg,
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
  getBaseline(): ChairPoseBaseline | null { return this.confirmedBaseline; }
}

/** Convenience: trunkLeanDeg takes midpoints; on side-on we pass the single
 *  visible landmark as its own midpoint. */
function midpointOf(a: NormalizedLandmark, b: NormalizedLandmark): { x: number; y: number } {
  return midpoint(a, b);
}
