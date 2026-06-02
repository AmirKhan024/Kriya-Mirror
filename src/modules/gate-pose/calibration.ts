/**
 * Gate Pose calibration — 4 gates, FRONT-facing camera. Mirrors Triangle
 * Pose's shape (shoulder-width-normalized distance + Fix F hysteresis + Fix X
 * floor). Gate semantics remapped for the kneeling lateral side-bend:
 *   fullBodyVisible → shoulders + wrists + hips + knees + ankles visible
 *   feetWide        → wide stance: ankle X distance > shoulder width × 1.2
 *                     (one leg extended out to the side)
 *   armsOverhead    → side-bend posture: lateral lean ≥ MIN_BEND_DEG AND the
 *                     raised (top) wrist is clearly above the shoulder line.
 *                     The lean direction sets bendSide; the higher wrist is the
 *                     top arm.
 *   distanceOk      → shoulder width within the hysteresis band, Fix X floor.
 */
import type { PoseLandmarks } from '@/modules/pose/types';
import type { CalibrationUpdate, CalibrationBaseline } from '@/modules/squat/types';
import { LM, lmVisible, midpoint, lateralLeanDeg } from './geometry';
import type { GatePoseBaseline } from './types';
import { debugLog } from '@/lib/debug';

const CONFIRM_DURATION_MS = 200;
const BAD_POSTURE_BUFFER_MS = 300;
const TIMEOUT_MS = 20_000;

// Wide-stance gate: ankle X distance must be at least this multiple of shoulder
// width (the extended leg makes the feet clearly wider than the shoulders).
const WIDE_STANCE_RATIO_MIN = 1.0;

// "Ready" posture at calibration — NOT the full deep bend. A leaning torso
// shrinks shoulderWidth and trips the distance gate (physical test: false "step
// closer"), so calibrate a near-upright kneeling-ready stance (slight lean +
// top arm raised) and let the hold drive/score the deep bend.
const MIN_BEND_DEG = 8;
const TOP_ARM_ABOVE_MIN = 0.03;   // (shoulderY − topWrist.y)/bodyHeight — arm just raised toward/above shoulder

// Distance gate via BODY HEIGHT (shoulder-to-lowest-foot vertical span), NOT
// shoulderWidth. A kneeling lateral side-bend foreshortens the shoulder line so
// shoulderWidth collapses exactly when the user poses (physical test: false
// "too-far" the moment they bend). Body height is robust to the bend — the same
// metric star-pose / figure-4 use. Lenient band (kneeling compresses height).
const MIN_BODY_HEIGHT_ENTER = 0.28;
const MAX_BODY_HEIGHT_ENTER = 1.00;
const MIN_BODY_HEIGHT_EXIT = 0.24;
const MAX_BODY_HEIGHT_EXIT = 1.05;

// Tiny shoulder-width floor — ONLY a division guard for the wide-stance ratio
// (a near-zero shoulderWidth would blow it up); it no longer gates distance.
export const MIN_SHOULDER_WIDTH = 0.05;

export class GatePoseCalibration {
  private startedAt: number;
  private goodPostureStart = 0;
  private badPostureStart = 0;
  private confirmedBaseline: GatePoseBaseline | null = null;
  private state: 'waiting' | 'good' | 'confirmed' | 'timeout' = 'waiting';
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
      debugLog('GATE', 'CALIB', `${prevState} → ${this.state}`, {
        gates: {
          fullBody: checks.fullBodyVisible,
          wideStance: checks.feetWide,
          bendReady: checks.armsOverhead,
          dist: checks.distanceOk,
        },
        distHint: distanceHint,
        bendSide: baselineCandidate?.bendSide,
        topArm: baselineCandidate?.topArm,
      });
    }

    return this.makeUpdate();
  }

  private checkGates(landmarks: PoseLandmarks): {
    checks: CalibrationUpdate['checks'];
    distanceHint: 'too-close' | 'too-far' | null;
    baselineCandidate: GatePoseBaseline | null;
  } {
    const ls = landmarks[LM.LEFT_SHOULDER];
    const rs = landmarks[LM.RIGHT_SHOULDER];
    const lw = landmarks[LM.LEFT_WRIST];
    const rw = landmarks[LM.RIGHT_WRIST];
    const lh = landmarks[LM.LEFT_HIP];
    const rh = landmarks[LM.RIGHT_HIP];
    const lk = landmarks[LM.LEFT_KNEE];
    const rk = landmarks[LM.RIGHT_KNEE];
    const la = landmarks[LM.LEFT_ANKLE];
    const ra = landmarks[LM.RIGHT_ANKLE];

    const fullBodyVisible = lmVisible(ls) && lmVisible(rs)
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
    const shoulderMid = midpoint(ls, rs);
    const hipMid = midpoint(lh, rh);
    const shoulderY = shoulderMid.y;
    const ankleY = (la.y + ra.y) / 2;
    const bodyHeight = Math.abs(ankleY - shoulderY);
    const ankleXDistance = Math.abs(la.x - ra.x);

    // Distance gate via body height (shoulder → lowest foot) + Fix F hysteresis.
    // Robust to the side-bend, unlike shoulderWidth.
    const distBodyHeight = Math.max(la.y, ra.y) - shoulderY;
    const min = this.distInBand ? MIN_BODY_HEIGHT_EXIT : MIN_BODY_HEIGHT_ENTER;
    const max = this.distInBand ? MAX_BODY_HEIGHT_EXIT : MAX_BODY_HEIGHT_ENTER;
    let distanceOk = true;
    let distanceHint: 'too-close' | 'too-far' | null = null;
    if (distBodyHeight < min) {
      distanceOk = false;
      distanceHint = 'too-far';
    } else if (distBodyHeight > max) {
      distanceOk = false;
      distanceHint = 'too-close';
    }
    this.distInBand = distanceOk;

    // Wide-stance gate (extended leg out to the side).
    const widthRatio = shoulderWidth > MIN_SHOULDER_WIDTH
      ? ankleXDistance / shoulderWidth
      : 0;
    const wideStance = widthRatio >= WIDE_STANCE_RATIO_MIN;

    // Side-bend posture: clear lateral lean + raised top arm.
    const leanDeg = lateralLeanDeg(shoulderMid, hipMid);
    const bendSide: 'left' | 'right' = shoulderMid.x > hipMid.x ? 'right' : 'left';
    const topArm: 'left' | 'right' = lw.y <= rw.y ? 'left' : 'right';
    const topShoulder = topArm === 'left' ? ls : rs;
    const topWrist = topArm === 'left' ? lw : rw;
    const bhFloor = Math.max(bodyHeight, 0.10);
    const topArmRaised = (topShoulder.y - topWrist.y) / bhFloor >= TOP_ARM_ABOVE_MIN;
    const bendReady = leanDeg >= MIN_BEND_DEG && topArmRaised;

    const checks = {
      fullBodyVisible: true,
      feetWide: wideStance,     // remap: "wide" slot → "leg extended into a wide stance"
      armsOverhead: bendReady,  // remap: "overhead" slot → "side bend + top arm raised"
      distanceOk,
    };

    if (!checks.feetWide || !checks.armsOverhead || !checks.distanceOk) {
      return { checks, distanceHint, baselineCandidate: null };
    }

    const baseline: GatePoseBaseline = {
      bendSide,
      topArm,
      shoulderY,
      shoulderWidth,
      bodyHeight,
      initialLeanDeg: leanDeg,
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

  /** Adapter: the play page reads a squat-shaped baseline; only shoulderWidth +
   *  shoulderY matter to it. The engine reads its own GatePoseBaseline. */
  private toSquatBaseline(b: GatePoseBaseline): CalibrationBaseline {
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
  getBaseline(): GatePoseBaseline | null { return this.confirmedBaseline; }
}
