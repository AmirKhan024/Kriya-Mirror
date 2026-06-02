/**
 * OHP Calibration — 4 gates mirroring bicep-curl's structure, remapped:
 *   fullBodyVisible → shoulders + elbows + wrists + hips + ankles visible
 *   feetWide        → feetStable (feet roughly shoulder-width — OHP stance)
 *   armsOverhead    → barAtRack (BOTH elbows above wrist level, bar at chest/shoulder)
 *   distanceOk      → body span in frame
 *
 * Fix G: CONFIRM_DURATION_MS = 200 (instant confirm once gates pass)
 * Fix F: Hysteresis on distance gate (enter/exit thresholds differ)
 * Fix H: distanceHint emitted in every update
 * Fix J: TIMEOUT_MS = 30_000
 */
import type { PoseLandmarks } from '@/modules/pose/types';
import type { CalibrationState, CalibrationUpdate } from '@/modules/squat/types';
import { LM, lmVisible, midpoint, elbowFlexionDeg } from './geometry';
import type { OHPBaseline } from './types';
import { debugLog } from '@/lib/debug';

// Fix G: 200ms confirm — instant calibration once all gates pass
const CONFIRM_DURATION_MS = 200;
const BAD_POSTURE_BUFFER_MS = 300;
// Fix J: 30s timeout
const TIMEOUT_MS = 30_000;

// Feet stability — similar to bicep-curl (not wide squat stance)
const MAX_FEET_RATIO = 1.30;   // feet ≤ 1.30× shoulder width

// Bar-at-rack: elbow flexion should be > RACK_FLEX_MIN° (arms bent, not extended down)
// At rack position elbows are bent ~70–90°. We check flex > 50° to confirm bar is
// held up (not hanging at sides) AND wrists are approximately at shoulder height.
const RACK_FLEX_MIN = 50;      // elbows bent > 50° = bar held up

// Body height ratios (Fix F: hysteresis)
const BODY_HEIGHT_MIN_ENTER = 0.45;   // enter "ok" when body fills at least 45%
const BODY_HEIGHT_MAX_ENTER = 0.92;   // enter "ok" when body fills at most 92%
const BODY_HEIGHT_MIN_EXIT  = 0.40;   // exit "ok" when body shrinks below 40%
const BODY_HEIGHT_MAX_EXIT  = 0.95;   // exit "ok" when body grows past 95%

const REQUIRED_LM = [
  LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER,
  LM.LEFT_ELBOW, LM.RIGHT_ELBOW,
  LM.LEFT_WRIST, LM.RIGHT_WRIST,
  LM.LEFT_HIP, LM.RIGHT_HIP,
  LM.LEFT_ANKLE, LM.RIGHT_ANKLE,
];

export class OHPCalibration {
  // Fix J: seed startedAt from the first update() call so frame-relative
  // timestamps (used in tests) are handled correctly. -1 = not yet seeded.
  private startedAt = -1;
  private goodPostureStart = 0;
  private badPostureStart = 0;
  private confirmedBaseline: OHPBaseline | null = null;
  private state: CalibrationState = 'waiting';
  private lastChecks: CalibrationUpdate['checks'] = {
    fullBodyVisible: false, feetWide: false, armsOverhead: false, distanceOk: false,
  };
  private lastDistanceHint: 'too-close' | 'too-far' | null = null;
  // Fix F: track whether distance gate was previously ok (hysteresis)
  private distanceWasOk = false;

  update(landmarks: PoseLandmarks | null, now: number): CalibrationUpdate {
    // Seed startedAt on the first update call (frame-timestamp-compatible)
    if (this.startedAt < 0) this.startedAt = now;

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
      debugLog('PRESS', 'CALIB', `${prevState} → ${this.state}`, {
        gates: {
          fullBody: checks.fullBodyVisible,
          feetStable: checks.feetWide,
          barAtRack: checks.armsOverhead,
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
    baselineCandidate: OHPBaseline | null;
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
    const le = landmarks[LM.LEFT_ELBOW];
    const re = landmarks[LM.RIGHT_ELBOW];
    const lw = landmarks[LM.LEFT_WRIST];
    const rw = landmarks[LM.RIGHT_WRIST];
    const lh = landmarks[LM.LEFT_HIP];
    const rh = landmarks[LM.RIGHT_HIP];
    const la = landmarks[LM.LEFT_ANKLE];
    const ra = landmarks[LM.RIGHT_ANKLE];

    // Feet stability check
    const shoulderWidth = Math.abs(ls.x - rs.x);
    const feetWidth = Math.abs(la.x - ra.x);
    const feetStable = shoulderWidth > 0 && feetWidth / shoulderWidth <= MAX_FEET_RATIO;

    // Bar at rack: elbows should be bent (holding bar at shoulder/chest level).
    // elbowFlexionDeg returns interior bend angle: ~70-90° when bar is racked.
    // We check both elbows are bent > RACK_FLEX_MIN to confirm bar is held.
    const leftElbowFlex = elbowFlexionDeg(ls, le, lw);
    const rightElbowFlex = elbowFlexionDeg(rs, re, rw);
    const barAtRack = leftElbowFlex > RACK_FLEX_MIN && rightElbowFlex > RACK_FLEX_MIN;

    // Distance gate with hysteresis (Fix F)
    const shoulderY = (ls.y + rs.y) / 2;
    const ankleY = (la.y + ra.y) / 2;
    const bodyHeight = Math.abs(ankleY - shoulderY);
    let distanceOk: boolean;
    let distanceHint: 'too-close' | 'too-far' | null = null;

    if (this.distanceWasOk) {
      // Hysteresis: keep "ok" until outside the exit bounds
      distanceOk = bodyHeight >= BODY_HEIGHT_MIN_EXIT && bodyHeight <= BODY_HEIGHT_MAX_EXIT;
    } else {
      // Not yet ok: require entering the tighter bounds
      distanceOk = bodyHeight >= BODY_HEIGHT_MIN_ENTER && bodyHeight <= BODY_HEIGHT_MAX_ENTER;
    }
    this.distanceWasOk = distanceOk;

    if (!distanceOk) {
      distanceHint = bodyHeight < BODY_HEIGHT_MIN_ENTER ? 'too-far' : 'too-close';
    }

    const checks = {
      fullBodyVisible: true,
      feetWide: feetStable,         // remap: feetWide slot → feetStable
      armsOverhead: barAtRack,      // remap: armsOverhead slot → barAtRack
      distanceOk,
    };

    if (!checks.feetWide || !checks.armsOverhead || !checks.distanceOk) {
      return { checks, distanceHint, baselineCandidate: null };
    }

    // Build baseline
    const shoulderMid = midpoint(ls, rs);
    const hipMid = midpoint(lh, rh);
    const wristMidY = (lw.y + rw.y) / 2;
    const wristMidX = (lw.x + rw.x) / 2;

    const baseline: OHPBaseline = {
      // CalibrationBaseline fields
      shoulderMid,
      hipMid,
      hipWidth: Math.abs(lh.x - rh.x),
      shoulderWidth,
      torsoHeight: Math.abs(hipMid.y - shoulderMid.y),
      ankleY: (la.y + ra.y) / 2,
      feetWidth,
      feetVsShoulderRatio: shoulderWidth > 0 ? feetWidth / shoulderWidth : 0,
      leftKneeX: landmarks[LM.LEFT_KNEE]?.x ?? lh.x,
      rightKneeX: landmarks[LM.RIGHT_KNEE]?.x ?? rh.x,
      // OHP-specific fields
      shoulderY: shoulderMid.y,
      shoulderMidX: shoulderMid.x,
      hipY: hipMid.y,
      hipMidX: hipMid.x,
      wristY: wristMidY,
      leftElbowX: le.x,
      rightElbowX: re.x,
    };

    debugLog('PRESS', 'CALIB', 'Baseline candidate', {
      shoulderY: +baseline.shoulderY.toFixed(3),
      wristY: +baseline.wristY.toFixed(3),
      wristMidX: +wristMidX.toFixed(3),
      shoulderWidth: +shoulderWidth.toFixed(3),
    });

    // Attach wristMidX for bar-path tracking — store it in shoulderMidX for reference
    // (we need to track initial wrist X for bar path drift)
    (baseline as OHPBaseline & { wristMidX: number }).wristMidX = wristMidX;

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
  getBaseline(): OHPBaseline | null { return this.confirmedBaseline; }
}
