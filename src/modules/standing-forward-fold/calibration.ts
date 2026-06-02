/**
 * Standing Forward Fold calibration — 4 gates, mirroring plank's side-profile
 * shape so the play-page overlay code is shared. Field meanings are remapped:
 *   fullBodyVisible → shoulder + hip + knee + ankle visible on the camera side
 *   feetWide        → hinged forward (torso fold angle past FOLD_CALIB_MIN_DEG)
 *   armsOverhead    → legs straight (knee flexion under KNEE_STRAIGHT_MAX_DEG)
 *   distanceOk      → vertical body span in frame (with hysteresis + too-far floor)
 *
 * Calibration confirms IN the folded pose (like chair-pose / wall-sit): the user
 * hinges forward, holds, and it confirms ~instantly (200 ms debounce).
 */
import type { PoseLandmarks } from '@/modules/pose/types';
import type { CalibrationUpdate } from '@/modules/squat/types';
import { LM, lmVisible, trunkLeanDeg, kneeFlexionDeg } from '@/modules/squat/geometry';
import type { ForwardFoldBaseline } from './types';
import { debugLog } from '@/lib/debug';

// 2026-05-25 round 5 (Fix G): instant confirm — 200 ms debounce, not 2000.
const CONFIRM_DURATION_MS = 200;
const BAD_POSTURE_BUFFER_MS = 300;
const TIMEOUT_MS = 20000;

// Fold gate: torso must be hinged forward at least this far from vertical.
const FOLD_CALIB_MIN_DEG = 60;
// Legs gate: a forward fold is a hip hinge — knees stay near-straight.
const KNEE_STRAIGHT_MAX_DEG = 30;

// Distance via vertical body span (|ankleY − shoulderY|), with enter/exit
// hysteresis (Fix F) so frame jitter near the threshold doesn't flip the gate.
// The MIN edge doubles as the Fix X analog: a too-small span means the user is
// too far / poorly detected, so we reject the baseline as 'too-far'. (Runtime
// metrics are pure angles, so there is no distance normalizer to collapse —
// this gate is the only place distance matters.)
const BODY_HEIGHT_MIN_ENTER = 0.40;
const BODY_HEIGHT_MAX_ENTER = 0.92;
const BODY_HEIGHT_MIN_EXIT = 0.36;
const BODY_HEIGHT_MAX_EXIT = 0.97;

export class ForwardFoldCalibration {
  private startedAt: number;
  private goodPostureStart = 0;
  private badPostureStart = 0;
  private confirmedBaseline: ForwardFoldBaseline | null = null;
  private state: 'waiting' | 'good' | 'confirmed' | 'timeout' = 'waiting';
  private lastChecks: CalibrationUpdate['checks'] = {
    fullBodyVisible: false, feetWide: false, armsOverhead: false, distanceOk: false,
  };
  private lastDistanceHint: 'too-close' | 'too-far' | null = null;
  // Persisted across frames to apply the wider "exit" thresholds once in-band.
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
      debugLog('FOLD', 'CALIB', `${prevState} → ${this.state}`, {
        gates: {
          sideProfile: checks.fullBodyVisible,
          folded: checks.feetWide,
          legsStraight: checks.armsOverhead,
          dist: checks.distanceOk,
        },
        distHint: distanceHint,
        side: baselineCandidate?.side,
      });
    }

    return this.makeUpdate();
  }

  private checkGates(landmarks: PoseLandmarks): {
    checks: CalibrationUpdate['checks'];
    distanceHint: 'too-close' | 'too-far' | null;
    baselineCandidate: ForwardFoldBaseline | null;
  } {
    // Pick the better-visible side (the camera-facing profile).
    const ls = landmarks[LM.LEFT_SHOULDER];
    const rs = landmarks[LM.RIGHT_SHOULDER];
    const lh = landmarks[LM.LEFT_HIP];
    const rh = landmarks[LM.RIGHT_HIP];
    const lk = landmarks[LM.LEFT_KNEE];
    const rk = landmarks[LM.RIGHT_KNEE];
    const la = landmarks[LM.LEFT_ANKLE];
    const ra = landmarks[LM.RIGHT_ANKLE];

    const leftScore = (ls?.visibility ?? 0) + (lh?.visibility ?? 0) + (lk?.visibility ?? 0) + (la?.visibility ?? 0);
    const rightScore = (rs?.visibility ?? 0) + (rh?.visibility ?? 0) + (rk?.visibility ?? 0) + (ra?.visibility ?? 0);
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

    // Folded forward: torso fold angle from vertical.
    const foldAngle = trunkLeanDeg({ x: shoulder.x, y: shoulder.y }, { x: hip.x, y: hip.y });
    const folded = foldAngle >= FOLD_CALIB_MIN_DEG;

    // Legs straight: knee flexion under the threshold (hip hinge, not a squat).
    const kneeFlex = kneeFlexionDeg(hip, knee, ankle);
    const legsStraight = kneeFlex <= KNEE_STRAIGHT_MAX_DEG;

    // Distance via vertical body span, with hysteresis.
    const bodyHeightY = Math.abs(ankle.y - shoulder.y);
    const min = this.distInBand ? BODY_HEIGHT_MIN_EXIT : BODY_HEIGHT_MIN_ENTER;
    const max = this.distInBand ? BODY_HEIGHT_MAX_EXIT : BODY_HEIGHT_MAX_ENTER;
    let distanceOk = true;
    let distanceHint: 'too-close' | 'too-far' | null = null;
    if (bodyHeightY < min) {
      distanceOk = false;
      distanceHint = 'too-far';
    } else if (bodyHeightY > max) {
      distanceOk = false;
      distanceHint = 'too-close';
    }
    this.distInBand = distanceOk;

    const checks = {
      fullBodyVisible: true,
      feetWide: folded,            // remap: "wide" slot → "hinged forward"
      armsOverhead: legsStraight,  // remap: "overhead" slot → "legs straight"
      distanceOk,
    };

    if (!checks.feetWide || !checks.armsOverhead || !checks.distanceOk) {
      return { checks, distanceHint, baselineCandidate: null };
    }

    const baseline: ForwardFoldBaseline = {
      side,
      shoulderY: shoulder.y,
      hipY: hip.y,
      bodyHeightY,
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
      // Baseline is read internally via getBaseline() (like plank) — the shared
      // CalibrationUpdate.baseline shape assumes squat's front-facing fields,
      // which don't apply to this side-profile engine.
    };
  }

  isConfirmed(): boolean { return this.state === 'confirmed'; }
  getBaseline(): ForwardFoldBaseline | null { return this.confirmedBaseline; }
}
