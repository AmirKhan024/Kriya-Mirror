/**
 * Triangle Pose calibration — 4 gates, FRONT-facing camera. Mirrors the
 * goddess-pose calibration shape (shoulderWidth-normalized distance + Fix F
 * hysteresis + Fix X floor). Gate semantics remapped for triangle:
 *   fullBodyVisible → shoulders + elbows + wrists + hips + knees + ankles
 *                     all visible (front camera, both arms + both legs)
 *   feetWide        → wide stance: ankle X distance > shoulder width × 1.6
 *                     AND both knees already straight (< MAX_KNEE_FLEX_AT_CAL_DEG)
 *   armsOverhead    → triangle posture detected: one wrist clearly ABOVE the
 *                     shoulder line (top arm to sky) AND the other wrist
 *                     clearly BELOW the hip line (bottom arm reaching for the
 *                     front foot). The lower wrist defines the bottom arm,
 *                     and the foot on that same side is the front leg.
 *   distanceOk      → shoulder width within hysteresis band [enter 0.12–0.32,
 *                     exit 0.10–0.36]. Floor at MIN_SHOULDER_WIDTH = 0.08
 *                     (Fix X — degenerate baselines collapse every distance-
 *                     normalized check at runtime).
 */
import type { PoseLandmarks } from '@/modules/pose/types';
import type { CalibrationUpdate, CalibrationBaseline } from '@/modules/squat/types';
import { LM, lmVisible, kneeFlexionDeg, midpoint, topArmDeviationDeg, bottomArmFromAnkleY } from './geometry';
import type { TrianglePoseBaseline } from './types';
import { debugLog } from '@/lib/debug';

// Fix G — instant calibration.
const CONFIRM_DURATION_MS = 200;
const BAD_POSTURE_BUFFER_MS = 300;
// Fix J — calibration timeout.
const TIMEOUT_MS = 20_000;

// Wide-stance gate: ankle X distance must be at least this multiple of
// shoulder width. ~1.6 = feet clearly wider than shoulders.
const WIDE_STANCE_RATIO_MIN = 1.6;

// Triangle posture: both knees straight (legs locked) at calibration.
const MAX_KNEE_FLEX_AT_CAL_DEG = 25;

// Top-arm wrist must sit at least this far ABOVE the shoulder line,
// normalized by bodyHeight.
const TOP_ARM_ABOVE_SHOULDER_MIN = 0.10;
// Bottom-arm wrist must sit at least this far BELOW the hip line,
// normalized by bodyHeight.
const BOTTOM_ARM_BELOW_HIP_MIN = 0.05;

// Fix F — distance hysteresis bands (front-on, shoulder-width normalized).
const MIN_SHOULDER_WIDTH_ENTER = 0.12;
const MAX_SHOULDER_WIDTH_ENTER = 0.32;
const MIN_SHOULDER_WIDTH_EXIT = 0.10;
const MAX_SHOULDER_WIDTH_EXIT = 0.36;

// Fix X — hard floor on shoulder width. Below this, every distance-normalized
// check collapses → surface as 'too-far' even if other gates pass.
export const MIN_SHOULDER_WIDTH = 0.08;

export class TrianglePoseCalibration {
  private startedAt: number;
  private goodPostureStart = 0;
  private badPostureStart = 0;
  private confirmedBaseline: TrianglePoseBaseline | null = null;
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
      debugLog('TRIANGLE', 'CALIB', `${prevState} → ${this.state}`, {
        gates: {
          fullBody: checks.fullBodyVisible,
          wideStance: checks.feetWide,
          postureReady: checks.armsOverhead,
          dist: checks.distanceOk,
        },
        distHint: distanceHint,
        topArm: baselineCandidate?.topArm,
        frontLeg: baselineCandidate?.frontLeg,
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
    baselineCandidate: TrianglePoseBaseline | null;
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

    // 2D shoulder span (not the X projection). In triangle the trunk hinges
    // sideways and the shoulder line TILTS — the X projection alone would
    // collapse, falsely failing the distance gate. The 2D Euclidean span
    // stays ~constant since the shoulder line just rotates around the spine.
    const shoulderWidth = Math.hypot(ls.x - rs.x, ls.y - rs.y);
    const shoulderY = (ls.y + rs.y) / 2;
    const ankleY = (la.y + ra.y) / 2;
    const hipY = (lh.y + rh.y) / 2;
    const bodyHeight = Math.abs(ankleY - shoulderY);
    const ankleXDistance = Math.abs(la.x - ra.x);

    // Distance gate with Fix F hysteresis + Fix X hard floor.
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
    if (shoulderWidth < MIN_SHOULDER_WIDTH) {
      distanceOk = false;
      distanceHint = 'too-far';
    }
    this.distInBand = distanceOk;

    // Wide-stance gate.
    const leftFlex = kneeFlexionDeg(lh, lk, la);
    const rightFlex = kneeFlexionDeg(rh, rk, ra);
    const bothLegsStraight = leftFlex < MAX_KNEE_FLEX_AT_CAL_DEG
      && rightFlex < MAX_KNEE_FLEX_AT_CAL_DEG;
    const widthRatio = shoulderWidth > MIN_SHOULDER_WIDTH
      ? ankleXDistance / shoulderWidth
      : 0;
    const wideStance = widthRatio >= WIDE_STANCE_RATIO_MIN && bothLegsStraight;

    // Auto-detect top arm: wrist with the smaller Y (higher in frame).
    const topArm: 'left' | 'right' = lw.y <= rw.y ? 'left' : 'right';
    const topWrist = topArm === 'left' ? lw : rw;
    const bottomWrist = topArm === 'left' ? rw : lw;
    // Front leg = the leg on the BOTTOM-ARM side (classical convention).
    const frontLeg: 'left' | 'right' = topArm === 'left' ? 'right' : 'left';
    const frontAnkle = frontLeg === 'left' ? la : ra;

    // Triangle posture: top wrist above shoulder line AND bottom wrist below
    // hip line. Both normalized by bodyHeight (with a floor to avoid div-by-0).
    const bhFloor = Math.max(bodyHeight, 0.10);
    const topArmRaised = (shoulderY - topWrist.y) / bhFloor >= TOP_ARM_ABOVE_SHOULDER_MIN;
    const bottomArmLow = (bottomWrist.y - hipY) / bhFloor >= BOTTOM_ARM_BELOW_HIP_MIN;
    const postureReady = bothLegsStraight && topArmRaised && bottomArmLow;

    const checks = {
      fullBodyVisible: true,
      feetWide: wideStance,        // remap: "wide" slot → "wide triangle stance + legs straight"
      armsOverhead: postureReady,  // remap: "overhead" slot → "triangle arm posture detected"
      distanceOk,
    };

    if (!checks.feetWide || !checks.armsOverhead || !checks.distanceOk) {
      return { checks, distanceHint, baselineCandidate: null };
    }

    const topShoulder = topArm === 'left' ? ls : rs;
    const initialTopArmDev = topArmDeviationDeg(topShoulder, topWrist);
    const initialBottomArmFromAnkleY = bottomArmFromAnkleY(bottomWrist, frontAnkle, bodyHeight);

    const baseline: TrianglePoseBaseline = {
      topArm,
      frontLeg,
      shoulderY,
      shoulderWidth,
      bodyHeight,
      initialAvgKneeFlexDeg: (leftFlex + rightFlex) / 2,
      initialTopArmDeviationDeg: initialTopArmDev,
      initialBottomArmFromAnkleY,
    };
    void midpoint; // helper imported for symmetry with goddess; not used here
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

  /** Adapter: play page reads a squat-shaped baseline. Only the fields the
   *  page actually uses need real values; the engine reads its own
   *  TrianglePoseBaseline via getBaseline(). */
  private toSquatBaseline(b: TrianglePoseBaseline): CalibrationBaseline {
    return {
      shoulderMid: { x: 0, y: b.shoulderY },
      hipMid: { x: 0, y: 0 },
      hipWidth: 0,
      shoulderWidth: b.shoulderWidth,
      torsoHeight: 0,
      ankleY: 0,
      feetWidth: 0,
      feetVsShoulderRatio: 0,
      leftKneeX: 0,
      rightKneeX: 0,
    };
  }

  isConfirmed(): boolean { return this.state === 'confirmed'; }
  getBaseline(): TrianglePoseBaseline | null { return this.confirmedBaseline; }
}
