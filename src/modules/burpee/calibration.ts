/**
 * BurpeeCalibration — side-facing camera, standing position.
 * Mirrors conventional-deadlift/calibration.ts with side-profile detection.
 *
 * Gates:
 *   1. fullBodyVisible — shoulder, hip, knee, ankle all visible (visibility > 0.3)
 *   2. sideProfile     — camera-side profile confirmed (shoulder X diff > threshold)
 *   3. armsAtSides     — wrist below shoulder (arms relaxed)
 *   4. distanceOk      — body height within [0.50, 0.90] of frame height
 *
 * CalibrationUpdate.checks field mapping:
 *   fullBodyVisible → fullBodyVisible
 *   feetWide        → sideProfile
 *   armsOverhead    → armsAtSides
 *   distanceOk      → distanceOk
 */

import type { PoseLandmarks } from '@/modules/pose/types';
import { LM, lmVisible, kneeFlexionDeg } from './geometry';
import type { CalibrationUpdate, MostBlockingGate } from '@/modules/squat/types';
import type { BurpeeBaseline } from './types';
import { debugLog } from '@/lib/debug';

const CONFIRM_DURATION_MS = 200;          // Fix G: instant confirm (debounce only)
const BAD_POSTURE_BUFFER_MS = 300;
const TIMEOUT_MS = 30_000;               // Fix J

// Distance gate with hysteresis (Fix F)
const BODY_HEIGHT_MIN_ENTER = 0.50;
const BODY_HEIGHT_MAX_ENTER = 0.90;
const BODY_HEIGHT_MIN_EXIT  = 0.45;
const BODY_HEIGHT_MAX_EXIT  = 0.92;

// Side-profile gate: shoulder-to-shoulder X difference should be small
// (user turned sideways → both shoulders at roughly same X).
// If |leftShoulder.x - rightShoulder.x| < SIDE_PROFILE_MAX_DIFF, user is sideways.
const SIDE_PROFILE_MAX_DIFF = 0.12;

// Plank/jump thresholds (injected into baseline)
const PLANK_ENTER = 0.14;
const JUMP_ENTER_THRESHOLD = 0.04;

const REQUIRED_LM = [
  LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER,
  LM.LEFT_HIP, LM.RIGHT_HIP,
  LM.LEFT_KNEE, LM.RIGHT_KNEE,
  LM.LEFT_ANKLE, LM.RIGHT_ANKLE,
];

type CalibrationState = 'waiting' | 'good' | 'confirmed' | 'timeout';

export class BurpeeCalibration {
  private startedAt: number;
  private goodPostureStart = 0;
  private badPostureStart = 0;
  private confirmedBaseline: BurpeeBaseline | null = null;
  private state: CalibrationState = 'waiting';
  private lastChecks: CalibrationUpdate['checks'] = {
    fullBodyVisible: false, feetWide: false, armsOverhead: false, distanceOk: false,
  };
  private lastDistanceHint: 'too-close' | 'too-far' | null = null;
  private lastMostBlockingGate: MostBlockingGate = null;
  private distInBand = false;

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
        mostBlockingGate: null,
        idleHintMs: 0,
      };
    }

    if (now - this.startedAt > TIMEOUT_MS) {
      this.state = 'timeout';
      return this.makeUpdate(now);
    }

    if (!landmarks) {
      this.resetProgress();
      this.lastChecks = { fullBodyVisible: false, feetWide: false, armsOverhead: false, distanceOk: false };
      this.lastDistanceHint = null;
      this.lastMostBlockingGate = 'no-body';
      return this.makeUpdate(now);
    }

    const { checks, distanceHint } = this.checkGates(landmarks);
    this.lastChecks = checks;
    this.lastDistanceHint = distanceHint;
    this.lastMostBlockingGate = this.pickMostBlockingGate(checks, distanceHint);
    const allPass = checks.fullBodyVisible && checks.feetWide && checks.armsOverhead && checks.distanceOk;

    const prevState = this.state;
    if (allPass) {
      this.badPostureStart = 0;
      if (this.goodPostureStart === 0) this.goodPostureStart = now;
      const heldMs = now - this.goodPostureStart;
      if (heldMs >= CONFIRM_DURATION_MS) {
        this.confirmedBaseline = this.captureBaseline(landmarks);
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
      debugLog('BURPEE', 'CALIB', `${prevState} → ${this.state}`, {
        gates: {
          fullBody: checks.fullBodyVisible,
          sideProfile: checks.feetWide,
          armsAtSides: checks.armsOverhead,
          dist: checks.distanceOk,
        },
        distHint: distanceHint,
        blocking: this.lastMostBlockingGate,
      });
    }

    return this.makeUpdate(now);
  }

  private checkGates(landmarks: PoseLandmarks): {
    checks: CalibrationUpdate['checks'];
    distanceHint: 'too-close' | 'too-far' | null;
  } {
    const fullBodyVisible = REQUIRED_LM.every((i) => lmVisible(landmarks[i]));
    if (!fullBodyVisible) {
      return {
        checks: { fullBodyVisible: false, feetWide: false, armsOverhead: false, distanceOk: false },
        distanceHint: null,
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

    // Side profile: shoulders are close in X (user turned 90° to camera)
    const shoulderXDiff = Math.abs(ls.x - rs.x);
    const sideProfile = shoulderXDiff < SIDE_PROFILE_MAX_DIFF;

    // Arms at sides: at least the visible-side wrist is below shoulder
    const wristsVisible = lmVisible(lw) || lmVisible(rw);
    const leftWristBelowShoulder = lmVisible(lw) ? lw.y > ls.y : true;
    const rightWristBelowShoulder = lmVisible(rw) ? rw.y > rs.y : true;
    const armsAtSides = wristsVisible && leftWristBelowShoulder && rightWristBelowShoulder;

    // Distance: body height (shoulder Y to ankle Y) as fraction of frame
    const shoulderY = (ls.y + rs.y) / 2;
    const ankleY = (la.y + ra.y) / 2;
    const bodyHeight = Math.abs(ankleY - shoulderY);

    // Hysteresis (Fix F)
    let distanceOk: boolean;
    let distanceHint: 'too-close' | 'too-far' | null = null;
    if (!this.distInBand) {
      distanceOk = bodyHeight >= BODY_HEIGHT_MIN_ENTER && bodyHeight <= BODY_HEIGHT_MAX_ENTER;
    } else {
      distanceOk = bodyHeight >= BODY_HEIGHT_MIN_EXIT && bodyHeight <= BODY_HEIGHT_MAX_EXIT;
    }
    if (distanceOk) {
      this.distInBand = true;
    } else {
      this.distInBand = false;
      distanceHint = bodyHeight < BODY_HEIGHT_MIN_ENTER ? 'too-far' : 'too-close';
    }

    // Also set hint if within band but using exit thresholds and it failed
    if (!distanceOk && distanceHint === null) {
      distanceHint = bodyHeight < BODY_HEIGHT_MIN_EXIT ? 'too-far' : 'too-close';
    }

    void lh; void rh; // used in captureBaseline

    return {
      checks: {
        fullBodyVisible,
        feetWide: sideProfile,          // semantic: "side profile"
        armsOverhead: armsAtSides,      // semantic: "arms at sides"
        distanceOk,
      },
      distanceHint,
    };
  }

  private captureBaseline(landmarks: PoseLandmarks): BurpeeBaseline {
    const ls = landmarks[LM.LEFT_SHOULDER];
    const rs = landmarks[LM.RIGHT_SHOULDER];
    const lh = landmarks[LM.LEFT_HIP];
    const rh = landmarks[LM.RIGHT_HIP];
    const la = landmarks[LM.LEFT_ANKLE];
    const ra = landmarks[LM.RIGHT_ANKLE];
    const lk = landmarks[LM.LEFT_KNEE];
    const rk = landmarks[LM.RIGHT_KNEE];

    // Determine which side is the primary (more visible) side
    const leftScore = (ls.visibility ?? 0) + (lh.visibility ?? 0) + (la.visibility ?? 0);
    const rightScore = (rs.visibility ?? 0) + (rh.visibility ?? 0) + (ra.visibility ?? 0);
    const side: 'left' | 'right' = leftScore >= rightScore ? 'left' : 'right';

    const shoulder = side === 'left' ? ls : rs;
    const hip = side === 'left' ? lh : rh;
    const ankle = side === 'left' ? la : ra;
    const knee = side === 'left' ? lk : rk;

    const shoulderY = (ls.y + rs.y) / 2;
    const ankleY = (la.y + ra.y) / 2;
    const hipY = (lh.y + rh.y) / 2;
    const kneeY = (lk.y + rk.y) / 2;

    const kneeAngleAtCalibration = kneeFlexionDeg(hip, knee, ankle);

    const baseline: BurpeeBaseline = {
      hipY,
      kneeY,
      shoulderY,
      ankleY,
      side,
      bodyLengthY: Math.abs(ankleY - shoulderY),
      hipX: hip.x,
      shoulderX: shoulder.x,
      kneeAngleAtCalibration,
      plankHipYThreshold: hipY + PLANK_ENTER,
      jumpHipYThreshold: hipY - JUMP_ENTER_THRESHOLD,
    };

    debugLog('BURPEE', 'CALIB', 'Baseline captured', {
      hipY: +hipY.toFixed(3),
      shoulderY: +shoulderY.toFixed(3),
      ankleY: +ankleY.toFixed(3),
      plankThresh: +baseline.plankHipYThreshold.toFixed(3),
      jumpThresh: +baseline.jumpHipYThreshold.toFixed(3),
      side,
    });

    return baseline;
  }

  private resetProgress(): void {
    this.goodPostureStart = 0;
    this.badPostureStart = 0;
  }

  private makeUpdate(now: number): CalibrationUpdate {
    return {
      state: this.state,
      progressMs: this.goodPostureStart > 0
        ? Math.min(CONFIRM_DURATION_MS, now - this.goodPostureStart)
        : 0,
      checks: this.lastChecks,
      distanceHint: this.lastDistanceHint,
      mostBlockingGate: this.lastMostBlockingGate,
      idleHintMs: 0,
    };
  }

  private pickMostBlockingGate(
    checks: CalibrationUpdate['checks'],
    distanceHint: 'too-close' | 'too-far' | null,
  ): MostBlockingGate {
    if (!checks.fullBodyVisible) return 'no-body';
    if (!checks.distanceOk) return distanceHint === 'too-close' ? 'too-close' : 'too-far';
    if (!checks.feetWide) return 'feet-narrow';      // semantic: "not side profile"
    if (!checks.armsOverhead) return 'arms-not-overhead'; // semantic: "arms not at sides"
    return null;
  }

  isConfirmed(): boolean { return this.state === 'confirmed'; }
  getBaseline(): BurpeeBaseline | null { return this.confirmedBaseline; }
}

/** Adapter: map BurpeeBaseline → CalibrationBaseline shape for play page / HUD. */
export function toBurpeeCalibrationBaseline(b: BurpeeBaseline): import('@/modules/squat/types').CalibrationBaseline {
  return {
    shoulderMid: { x: b.shoulderX, y: b.shoulderY },
    hipMid: { x: b.hipX, y: b.hipY },
    hipWidth: 0.08,
    shoulderWidth: 0.08,
    torsoHeight: Math.abs(b.hipY - b.shoulderY),
    ankleY: b.ankleY,
    feetWidth: 0.10,
    feetVsShoulderRatio: 1.0,
    leftKneeX: b.hipX - 0.04,
    rightKneeX: b.hipX + 0.04,
  };
}
