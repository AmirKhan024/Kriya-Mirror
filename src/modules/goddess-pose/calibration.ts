/**
 * Goddess Pose calibration — 4 gates, FRONT-facing camera. Same gate shape as
 * the other hold engines but the field meanings remap to goddess stance:
 *   fullBodyVisible → all upper + lower bilateral landmarks visible (shoulders,
 *                     elbows, wrists, hips, knees, ankles)
 *   feetWide        → wide stance: ankle X distance > shoulder width × 1.6
 *                     AND both knees already bent (>= MIN_KNEE_FLEX_AT_CAL_DEG)
 *   armsOverhead    → cactus arms: both elbows at-or-above the shoulder line
 *                     (Y within tolerance), wrists outside the shoulder X line
 *   distanceOk      → shoulder width in frame within band (Fix F hysteresis)
 *                     AND >= MIN_SHOULDER_WIDTH (Fix X — reject degenerate
 *                     baselines that would collapse distance-normalized
 *                     thresholds at runtime).
 *
 * Arm position IS validated (front camera makes the cactus posture trackable —
 * unlike warrior-2 which is side-on and skips arm checks).
 */
import type { PoseLandmarks } from '@/modules/pose/types';
import type { CalibrationUpdate, CalibrationBaseline } from '@/modules/squat/types';
import { LM, lmVisible, kneeFlexionDeg, trunkLeanDeg, midpoint } from './geometry';
import type { GoddessPoseBaseline } from './types';
import { debugLog } from '@/lib/debug';

// Fix G — instant calibration.
const CONFIRM_DURATION_MS = 200;
const BAD_POSTURE_BUFFER_MS = 300;
// Fix J — calibration timeout.
const TIMEOUT_MS = 20_000;

// Wide-stance gate: ankle X distance must be at least this multiple of
// shoulder width. ~1.6 means feet are visibly wider than the shoulders (the
// hallmark of goddess pose).
const WIDE_STANCE_RATIO_MIN = 1.6;

// Both knees must already be at least this bent at calibration (so the user
// is in the pose when calibration confirms).
const MIN_KNEE_FLEX_AT_CAL_DEG = 50;

// Cactus arms — both elbows within this many shoulder-widths of the shoulder
// Y line (above or below). Tight tolerance because cactus is a defined pose.
const CACTUS_ELBOW_Y_TOL = 0.30;

// Cactus arms — both wrists at least this many shoulder-widths OUTSIDE the
// respective shoulder X (left wrist left of left shoulder, right wrist right
// of right shoulder). Filters out arms-at-side at calibration.
const CACTUS_WRIST_OUT_MIN = 0.20;

// Trunk should be reasonably upright at calibration.
const MAX_TRUNK_LEAN_AT_CAL_DEG = 30;

// Fix F — distance hysteresis bands (front-on, shoulder-width normalized).
const MIN_SHOULDER_WIDTH_ENTER = 0.12;
const MAX_SHOULDER_WIDTH_ENTER = 0.32;
const MIN_SHOULDER_WIDTH_EXIT = 0.10;
const MAX_SHOULDER_WIDTH_EXIT = 0.36;

// Fix X — hard floor on shoulder width. Below this, every distance-normalized
// check collapses → surface as 'too-far' even if other gates pass.
export const MIN_SHOULDER_WIDTH = 0.08;

export class GoddessPoseCalibration {
  private startedAt: number;
  private goodPostureStart = 0;
  private badPostureStart = 0;
  private confirmedBaseline: GoddessPoseBaseline | null = null;
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
      debugLog('GODDESS', 'CALIB', `${prevState} → ${this.state}`, {
        gates: {
          fullBody: checks.fullBodyVisible,
          wideStance: checks.feetWide,
          cactusArms: checks.armsOverhead,
          dist: checks.distanceOk,
        },
        distHint: distanceHint,
        avgKneeFlex: baselineCandidate
          ? +baselineCandidate.initialAvgKneeFlexDeg.toFixed(1)
          : null,
        shoulderWidth: baselineCandidate
          ? +baselineCandidate.shoulderWidth.toFixed(3)
          : null,
      });
    }

    return this.makeUpdate();
  }

  private checkGates(landmarks: PoseLandmarks): {
    checks: CalibrationUpdate['checks'];
    distanceHint: 'too-close' | 'too-far' | null;
    baselineCandidate: GoddessPoseBaseline | null;
  } {
    const ls = landmarks[LM.LEFT_SHOULDER];
    const rs = landmarks[LM.RIGHT_SHOULDER];
    const le = landmarks[LM.LEFT_ELBOW];
    const re = landmarks[LM.RIGHT_ELBOW];
    const lw = landmarks[LM.LEFT_WRIST];
    const rw = landmarks[LM.RIGHT_WRIST];
    const lh = landmarks[LM.LEFT_HIP];
    const rh = landmarks[LM.RIGHT_HIP];
    const lk = landmarks[LM.LEFT_KNEE];
    const rk = landmarks[LM.RIGHT_KNEE];
    const la = landmarks[LM.LEFT_ANKLE];
    const ra = landmarks[LM.RIGHT_ANKLE];

    // All upper + lower bilateral landmarks must be visible (front camera —
    // arms must be trackable for the cactus gate).
    const fullBodyVisible = lmVisible(ls) && lmVisible(rs)
      && lmVisible(le) && lmVisible(re)
      && lmVisible(lw) && lmVisible(rw)
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

    const shoulderWidth = Math.abs(ls.x - rs.x);
    const shoulderY = (ls.y + rs.y) / 2;
    const ankleY = (la.y + ra.y) / 2;
    const bodyHeight = Math.abs(ankleY - shoulderY);
    const ankleXDist = Math.abs(la.x - ra.x);

    // Distance gate (Fix F hysteresis on shoulder width, Fix X hard floor).
    const min = this.distInBand ? MIN_SHOULDER_WIDTH_EXIT : MIN_SHOULDER_WIDTH_ENTER;
    const max = this.distInBand ? MAX_SHOULDER_WIDTH_EXIT : MAX_SHOULDER_WIDTH_ENTER;
    let distanceOk = true;
    let distanceHint: 'too-close' | 'too-far' | null = null;
    if (shoulderWidth < min) {
      distanceOk = false;
      distanceHint = 'too-far';
    } else if (shoulderWidth > max) {
      distanceOk = false;
      distanceHint = 'too-close';
    }
    // Fix X — explicit floor reject (the band check above usually catches this).
    if (shoulderWidth < MIN_SHOULDER_WIDTH) {
      distanceOk = false;
      distanceHint = 'too-far';
    }
    this.distInBand = distanceOk;

    // Wide-stance gate: ankles clearly wider than shoulders AND both knees
    // already bent (user is in the pose).
    const leftFlex = kneeFlexionDeg(lh, lk, la);
    const rightFlex = kneeFlexionDeg(rh, rk, ra);
    const bothKneesBent = leftFlex >= MIN_KNEE_FLEX_AT_CAL_DEG
      && rightFlex >= MIN_KNEE_FLEX_AT_CAL_DEG;
    const widthRatio = shoulderWidth > MIN_SHOULDER_WIDTH
      ? ankleXDist / shoulderWidth
      : 0;
    const wideStance = widthRatio >= WIDE_STANCE_RATIO_MIN && bothKneesBent;

    // Cactus-arms gate: both elbows near the shoulder line (Y) AND both
    // wrists clearly outside the shoulder line (X). Normalized by shoulder
    // width with the runtime floor.
    const swFloor = Math.max(shoulderWidth, MIN_SHOULDER_WIDTH);
    const leftElbowYOffset = Math.abs(le.y - ls.y) / swFloor;
    const rightElbowYOffset = Math.abs(re.y - rs.y) / swFloor;
    const elbowsAtCactusHeight = leftElbowYOffset <= CACTUS_ELBOW_Y_TOL
      && rightElbowYOffset <= CACTUS_ELBOW_Y_TOL;
    // Wrist X expected outside the corresponding shoulder X. ls is on the
    // user's LEFT (right side of the image), so ls.x > rs.x in normalized
    // coords. Each wrist must be FURTHER OUT than its shoulder.
    const leftSideOutside = ls.x >= rs.x
      ? (lw.x - ls.x) / swFloor >= CACTUS_WRIST_OUT_MIN
      : (ls.x - lw.x) / swFloor >= CACTUS_WRIST_OUT_MIN;
    const rightSideOutside = rs.x <= ls.x
      ? (rs.x - rw.x) / swFloor >= CACTUS_WRIST_OUT_MIN
      : (rw.x - rs.x) / swFloor >= CACTUS_WRIST_OUT_MIN;
    const cactusArms = elbowsAtCactusHeight && leftSideOutside && rightSideOutside;

    const checks = {
      fullBodyVisible: true,
      feetWide: wideStance,        // remap: "wide" slot → "wide goddess stance + both knees bent"
      armsOverhead: cactusArms,    // remap: "overhead" slot → "arms in cactus position"
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

    const avgKneeFlex = (leftFlex + rightFlex) / 2;
    // Elbow Y relative to shoulder Y, signed (negative = elbow above shoulder).
    // Use the average of L + R for the baseline reference.
    const avgElbowY = (le.y + re.y) / 2;
    const elbowYRelShoulder = avgElbowY - shoulderY;

    const baseline: GoddessPoseBaseline = {
      shoulderY,
      shoulderWidth,
      bodyHeight,
      ankleXDist,
      initialAvgKneeFlexDeg: avgKneeFlex,
      initialElbowYRelShoulder: elbowYRelShoulder,
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
      baseline: this.confirmedBaseline ? this.toSquatBaseline(this.confirmedBaseline) : undefined,
    };
  }

  /** Adapter: the shared play page reads the squat-shaped baseline. Only the
   *  fields it actually uses need real values; everything else gets a sensible
   *  default. Goddess engine reads its own GoddessPoseBaseline via getBaseline(). */
  private toSquatBaseline(b: GoddessPoseBaseline): CalibrationBaseline {
    return {
      shoulderMid: { x: 0, y: b.shoulderY },
      hipMid: { x: 0, y: 0 },
      hipWidth: 0,
      shoulderWidth: b.shoulderWidth,
      torsoHeight: 0,
      ankleY: 0,
      feetWidth: b.ankleXDist,
      feetVsShoulderRatio: b.shoulderWidth > 0 ? b.ankleXDist / b.shoulderWidth : 0,
      leftKneeX: 0,
      rightKneeX: 0,
    };
  }

  isConfirmed(): boolean { return this.state === 'confirmed'; }
  getBaseline(): GoddessPoseBaseline | null { return this.confirmedBaseline; }
}
