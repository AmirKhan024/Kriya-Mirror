/**
 * Sit-to-Stand calibration — 4 gates, SIDE-facing camera, SEATED start.
 * Mirrors chair-pose's side-detection + bodyHeight-distance shape, remapped to
 * the seated ready position:
 *   fullBodyVisible → visible-side shoulder+hip+knee+ankle all visible
 *   feetWide        → seated (knee flexion within the seated band, ~90°)
 *   armsOverhead    → torsoUpright (trunk near-vertical while seated, not slumped)
 *   distanceOk      → body height (ankle-Y − shoulder-Y) within band, with a
 *                     too-far floor (Fix X analog for side-on pose)
 */
import type { PoseLandmarks, NormalizedLandmark } from '@/modules/pose/types';
import type { CalibrationState, CalibrationUpdate } from '@/modules/squat/types';
import { LM, lmVisible, kneeFlexionDeg, trunkLeanDeg, midpoint } from '@/modules/squat/geometry';
import type { SitToStandBaseline } from './types';
import { debugLog } from '@/lib/debug';

const CONFIRM_DURATION_MS = 200;     // Fix G
const BAD_POSTURE_BUFFER_MS = 300;   // Fix F
const TIMEOUT_MS = 20_000;           // Fix J

// Seated knee-flexion band. Sitting on a chair puts the knees near 90°; accept
// a generous window so users don't have to hit exactly 90° to confirm.
const MIN_SEATED_FLEX_DEG = 55;
const MAX_SEATED_FLEX_DEG = 120;

// Torso should be reasonably upright while seated (not slumped forward).
const MAX_TRUNK_LEAN_AT_CAL_DEG = 45;

const MIN_BODY_HEIGHT_ENTER = 0.45;
const MAX_BODY_HEIGHT_ENTER = 0.92;
const MIN_BODY_HEIGHT_EXIT = 0.40;
const MAX_BODY_HEIGHT_EXIT = 0.95;
// Fix X analog for side-on: bodyHeight floor below which the baseline is unusable.
const MIN_BODY_HEIGHT_RUNTIME = 0.30;

export class SitToStandCalibration {
  private startedAt: number;
  private goodPostureStart = 0;
  private badPostureStart = 0;
  private confirmedBaseline: SitToStandBaseline | null = null;
  private state: CalibrationState = 'waiting';
  private lastChecks: CalibrationUpdate['checks'] = {
    fullBodyVisible: false, feetWide: false, armsOverhead: false, distanceOk: false,
  };
  private lastDistanceHint: 'too-close' | 'too-far' | null = null;
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
      debugLog('SIT2STAND', 'CALIB', `${prevState} → ${this.state}`, {
        gates: {
          sideProfile: checks.fullBodyVisible,
          seated: checks.feetWide,
          torsoUpright: checks.armsOverhead,
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
    baselineCandidate: SitToStandBaseline | null;
  } {
    const ls = landmarks[LM.LEFT_SHOULDER];
    const rs = landmarks[LM.RIGHT_SHOULDER];
    const lh = landmarks[LM.LEFT_HIP];
    const rh = landmarks[LM.RIGHT_HIP];
    const lk = landmarks[LM.LEFT_KNEE];
    const rk = landmarks[LM.RIGHT_KNEE];
    const la = landmarks[LM.LEFT_ANKLE];
    const ra = landmarks[LM.RIGHT_ANKLE];

    // Pick the side with the better-visible side-on critical chain.
    const leftScore = (ls?.visibility ?? 0) + (lh?.visibility ?? 0)
      + (lk?.visibility ?? 0) + (la?.visibility ?? 0);
    const rightScore = (rs?.visibility ?? 0) + (rh?.visibility ?? 0)
      + (rk?.visibility ?? 0) + (ra?.visibility ?? 0);
    const side: 'left' | 'right' = leftScore >= rightScore ? 'left' : 'right';

    const shoulder = side === 'left' ? ls : rs;
    const hip = side === 'left' ? lh : rh;
    const knee = side === 'left' ? lk : rk;
    const ankle = side === 'left' ? la : ra;

    const fullBodyVisible = lmVisible(shoulder) && lmVisible(hip) && lmVisible(knee) && lmVisible(ankle);
    if (!fullBodyVisible) {
      return {
        checks: { fullBodyVisible: false, feetWide: false, armsOverhead: false, distanceOk: false },
        distanceHint: null,
        baselineCandidate: null,
      };
    }

    const kneeFlex = kneeFlexionDeg(hip, knee, ankle);
    const seated = kneeFlex >= MIN_SEATED_FLEX_DEG && kneeFlex <= MAX_SEATED_FLEX_DEG;

    const trunkDeg = trunkLeanDeg(asMid(shoulder), asMid(hip));
    const torsoUpright = trunkDeg <= MAX_TRUNK_LEAN_AT_CAL_DEG;

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
    if (bodyHeight < MIN_BODY_HEIGHT_RUNTIME) {
      distanceOk = false;
      distanceHint = 'too-far';
    }
    this.distInBand = distanceOk;

    const checks = {
      fullBodyVisible: true,
      feetWide: seated,            // remap: seated (knees bent ~90°)
      armsOverhead: torsoUpright,  // remap: torso upright (not slumped)
      distanceOk,
    };

    if (!checks.feetWide || !checks.armsOverhead || !checks.distanceOk) {
      return { checks, distanceHint, baselineCandidate: null };
    }

    const baseline: SitToStandBaseline = {
      side,
      seatedKneeFlexDeg: kneeFlex,
      shoulderY: shoulder.y,
      hipY: hip.y,
      ankleY: ankle.y,
      bodyHeight,
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
  getBaseline(): SitToStandBaseline | null { return this.confirmedBaseline; }
}

/** trunkLeanDeg takes midpoints; side-on we pass the single visible landmark. */
function asMid(lm: NormalizedLandmark): { x: number; y: number } {
  return midpoint(lm, lm);
}
