/**
 * Warrior II calibration — 4 gates, side-facing camera. Same gate shape as
 * chair-pose but the field meanings remap to lunge stance:
 *   fullBodyVisible → both legs visible on the side-facing chain
 *                     (shoulders + hips + both knees + both ankles)
 *   feetWide        → lunge stance detected: ankle X distance > body-height × 0.40
 *   armsOverhead    → posture-ready: front knee bent (>60°) AND back knee
 *                     straight (<25°). The front leg is auto-detected as
 *                     whichever knee has the larger flex.
 *   distanceOk      → body height in frame within band (Fix F + Fix X analog
 *                     for side-on: bodyHeight < MIN_BODY_HEIGHT_RUNTIME → too-far)
 *
 * Arm position is NOT validated (Z-axis tracking unreliable from side camera).
 */
import type { PoseLandmarks } from '@/modules/pose/types';
import type { CalibrationUpdate } from '@/modules/squat/types';
import { LM, lmVisible, kneeFlexionDeg, trunkLeanDeg, midpoint } from '@/modules/squat/geometry';
import type { WarriorTwoBaseline } from './types';
import { debugLog } from '@/lib/debug';

// Fix G — instant calibration.
const CONFIRM_DURATION_MS = 200;
const BAD_POSTURE_BUFFER_MS = 300;
// Fix J — calibration timeout.
const TIMEOUT_MS = 20_000;

// Lunge stance detection: ankle X distance must be at least this fraction of
// body height (vertical span). Filters out narrow stances.
const MIN_STANCE_RATIO = 0.40;

// Posture-ready: front knee must be clearly bent + back knee straight.
// 2026-05-28 round 19: dropped 60 → 55 (a touch easier to enter pose).
// Pairs with engine FRONT_KNEE_MIN_DEG=50 → 5° hysteresis between cal-accept
// (55°) and runtime-warn (50°). Real users hold 60–65° natural Warrior II.
const FRONT_KNEE_READY_MIN_DEG = 55;     // front knee flex > 55° at cal
const BACK_KNEE_READY_MAX_DEG = 25;      // back knee flex < 25° at cal

// Trunk should be reasonably upright at calibration.
const MAX_TRUNK_LEAN_AT_CAL_DEG = 35;

// Fix F — distance hysteresis bands (side-on, body-height normalized).
const MIN_BODY_HEIGHT_ENTER = 0.45;
const MAX_BODY_HEIGHT_ENTER = 0.88;
const MIN_BODY_HEIGHT_EXIT = 0.40;
const MAX_BODY_HEIGHT_EXIT = 0.93;

// Fix X analog for side-on: hard floor on bodyHeight. Below this = degenerate
// baseline (every distance-normalized check collapses) → surface as too-far.
const MIN_BODY_HEIGHT_RUNTIME = 0.30;

export class WarriorTwoCalibration {
  private startedAt: number;
  private goodPostureStart = 0;
  private badPostureStart = 0;
  private confirmedBaseline: WarriorTwoBaseline | null = null;
  private state: 'waiting' | 'good' | 'confirmed' | 'timeout' = 'waiting';
  private lastChecks: CalibrationUpdate['checks'] = {
    fullBodyVisible: false, feetWide: false, armsOverhead: false, distanceOk: false,
  };
  private lastDistanceHint: 'too-close' | 'too-far' | null = null;
  // Fix F — persisted band-membership for hysteresis.
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
      debugLog('WARRIOR', 'CALIB', `${prevState} → ${this.state}`, {
        gates: {
          fullBody: checks.fullBodyVisible,
          stance: checks.feetWide,
          postureReady: checks.armsOverhead,
          dist: checks.distanceOk,
        },
        distHint: distanceHint,
        frontLeg: baselineCandidate?.frontLeg,
      });
    }

    return this.makeUpdate();
  }

  private checkGates(landmarks: PoseLandmarks): {
    checks: CalibrationUpdate['checks'];
    distanceHint: 'too-close' | 'too-far' | null;
    baselineCandidate: WarriorTwoBaseline | null;
  } {
    const ls = landmarks[LM.LEFT_SHOULDER];
    const rs = landmarks[LM.RIGHT_SHOULDER];
    const lh = landmarks[LM.LEFT_HIP];
    const rh = landmarks[LM.RIGHT_HIP];
    const lk = landmarks[LM.LEFT_KNEE];
    const rk = landmarks[LM.RIGHT_KNEE];
    const la = landmarks[LM.LEFT_ANKLE];
    const ra = landmarks[LM.RIGHT_ANKLE];

    // Need both legs visible for front/back detection (unlike chair-pose which
    // only needs one side).
    const fullBodyVisible = lmVisible(ls) && lmVisible(rs)
      && lmVisible(lh) && lmVisible(rh)
      && lmVisible(lk) && lmVisible(rk)
      && lmVisible(la) && lmVisible(ra);
    if (!fullBodyVisible) {
      return {
        checks: { fullBodyVisible: false, feetWide: false, armsOverhead: false, distanceOk: false },
        distanceHint: null,
        baselineCandidate: null,
      };
    }

    // Pick the side with better combined visibility on the critical chain.
    // For Warrior II both sides are technically visible from side camera but
    // one is closer. Side with HIGHER avg visibility is the "near" side.
    const leftScore = (ls.visibility ?? 0) + (lh.visibility ?? 0)
      + (lk.visibility ?? 0) + (la.visibility ?? 0);
    const rightScore = (rs.visibility ?? 0) + (rh.visibility ?? 0)
      + (rk.visibility ?? 0) + (ra.visibility ?? 0);
    const side: 'left' | 'right' = leftScore >= rightScore ? 'left' : 'right';

    // Auto-detect front leg as the leg with the LARGER knee flex (the bent one).
    const leftFlex = kneeFlexionDeg(lh, lk, la);
    const rightFlex = kneeFlexionDeg(rh, rk, ra);
    const frontLeg: 'left' | 'right' = leftFlex > rightFlex ? 'left' : 'right';
    const frontKneeFlex = frontLeg === 'left' ? leftFlex : rightFlex;
    const backKneeFlex = frontLeg === 'left' ? rightFlex : leftFlex;

    // Body height (Y span — side-on distance reference)
    const shoulderY = (ls.y + rs.y) / 2;
    const ankleY = (la.y + ra.y) / 2;
    const bodyHeight = Math.abs(ankleY - shoulderY);

    // Stance gate: ankle X distance > body-height × 0.40 (feet are clearly apart)
    const ankleXDistance = Math.abs(la.x - ra.x);
    const lungeStance = bodyHeight > 0 && (ankleXDistance / bodyHeight) > MIN_STANCE_RATIO;

    // Posture-ready: front knee bent + back knee straight.
    const postureReady = frontKneeFlex > FRONT_KNEE_READY_MIN_DEG
      && backKneeFlex < BACK_KNEE_READY_MAX_DEG;

    // Distance gate with Fix F hysteresis
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
    // Fix X analog: explicit floor reject (the band check above usually catches
    // this; this is defensive in case bands are tuned wider in future).
    if (bodyHeight < MIN_BODY_HEIGHT_RUNTIME) {
      distanceOk = false;
      distanceHint = 'too-far';
    }
    this.distInBand = distanceOk;

    const checks = {
      fullBodyVisible: true,
      feetWide: lungeStance,         // remap: "wide" slot → "lunge stance detected"
      armsOverhead: postureReady,    // remap: "overhead" slot → "front knee bent + back knee straight"
      distanceOk,
    };

    if (!checks.feetWide || !checks.armsOverhead || !checks.distanceOk) {
      return { checks, distanceHint, baselineCandidate: null };
    }

    // Trunk lean sanity check — if leaning over at cal, reject.
    const shoulderMid = midpoint(ls, rs);
    const hipMid = midpoint(lh, rh);
    const trunkLean = trunkLeanDeg(shoulderMid, hipMid);
    if (trunkLean > MAX_TRUNK_LEAN_AT_CAL_DEG) {
      return {
        checks: { ...checks, armsOverhead: false }, // surface as posture-not-ready
        distanceHint,
        baselineCandidate: null,
      };
    }

    const baseline: WarriorTwoBaseline = {
      side,
      frontLeg,
      shoulderY,
      hipMidY: hipMid.y,
      bodyHeight,
      initialFrontKneeFlexDeg: frontKneeFlex,
      initialTrunkLeanDeg: trunkLean,
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
  getBaseline(): WarriorTwoBaseline | null { return this.confirmedBaseline; }
}
