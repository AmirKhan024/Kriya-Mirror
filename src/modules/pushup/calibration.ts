/**
 * Push-up calibration — side camera, mirrors plank's auto-side-detection plus
 * an "arms extended" gate (calibration captures the TOP of the push-up where
 * elbows are nearly straight).
 *
 * Reuses the squat CalibrationUpdate shape so the play-page overlay component
 * is shared. Field meanings are remapped:
 *   fullBodyVisible → shoulder+elbow+wrist+hip+ankle visible on the chosen side
 *   feetWide        → body horizontal (correct push-up orientation)
 *   armsOverhead    → arms extended (elbow flex < 18° on calibration side)
 *   distanceOk      → body length in frame is within the acceptable range
 */
import type { PoseLandmarks } from '@/modules/pose/types';
import type { CalibrationUpdate } from '@/modules/squat/types';
import { LM, lmVisible, elbowFlexionDeg } from './geometry';
import type { PushupBaseline } from './types';
import { debugLog } from '@/lib/debug';

// 2026-05-25 round 5 (§3.5): drop confirmation hold from 2000 → 200ms.
// Once all gates green, calibration confirms "instantly"; the 200ms is a
// single ~6-frame debounce against MediaPipe single-frame noise.
const CONFIRM_DURATION_MS = 200;
const BAD_POSTURE_BUFFER_MS = 300;
const TIMEOUT_MS = 20000;

const MIN_HORIZONTAL_RATIO = 3.0; // |dx| / |dy| ≥ 3.0 → roughly horizontal
const MIN_BODY_LENGTH_X = 0.45;
const MAX_BODY_LENGTH_X = 0.95;
const ARMS_EXTENDED_FLEX_MAX = 18; // elbow flex < 18° at calibration

export class PushupCalibration {
  private startedAt: number;
  private goodPostureStart = 0;
  private badPostureStart = 0;
  private confirmedBaseline: PushupBaseline | null = null;
  private state: 'waiting' | 'good' | 'confirmed' | 'timeout' = 'waiting';
  private lastChecks: CalibrationUpdate['checks'] = {
    fullBodyVisible: false, feetWide: false, armsOverhead: false, distanceOk: false,
  };
  private lastDistanceHint: 'too-close' | 'too-far' | null = null;

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
      debugLog('PUSHUP', 'CALIB', `${prevState} → ${this.state}`, {
        gates: {
          sideProfile: checks.fullBodyVisible,
          horizontal: checks.feetWide,
          armsExtended: checks.armsOverhead,
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
    baselineCandidate: PushupBaseline | null;
  } {
    const ls = landmarks[LM.LEFT_SHOULDER];
    const rs = landmarks[LM.RIGHT_SHOULDER];
    const lh = landmarks[LM.LEFT_HIP];
    const rh = landmarks[LM.RIGHT_HIP];
    const la = landmarks[LM.LEFT_ANKLE];
    const ra = landmarks[LM.RIGHT_ANKLE];
    const le = landmarks[LM.LEFT_ELBOW];
    const re = landmarks[LM.RIGHT_ELBOW];
    const lw = landmarks[LM.LEFT_WRIST];
    const rw = landmarks[LM.RIGHT_WRIST];
    const nose = landmarks[LM.NOSE];

    const leftScore = (ls?.visibility ?? 0) + (lh?.visibility ?? 0) + (la?.visibility ?? 0)
      + (le?.visibility ?? 0);
    const rightScore = (rs?.visibility ?? 0) + (rh?.visibility ?? 0) + (ra?.visibility ?? 0)
      + (re?.visibility ?? 0);
    const side: 'left' | 'right' = leftScore >= rightScore ? 'left' : 'right';

    const shoulder = side === 'left' ? ls : rs;
    const hip = side === 'left' ? lh : rh;
    const ankle = side === 'left' ? la : ra;
    const elbow = side === 'left' ? le : re;
    const wrist = side === 'left' ? lw : rw;

    const fullBodyVisible = lmVisible(shoulder) && lmVisible(hip) && lmVisible(ankle)
      && lmVisible(elbow) && lmVisible(wrist);
    if (!fullBodyVisible) {
      return {
        checks: { fullBodyVisible: false, feetWide: false, armsOverhead: false, distanceOk: false },
        distanceHint: null,
        baselineCandidate: null,
      };
    }

    // Body horizontal?
    const dx = Math.abs(ankle.x - shoulder.x);
    const dy = Math.abs(ankle.y - shoulder.y);
    const horizontalRatio = dy > 0.001 ? dx / dy : 999;
    const horizontal = horizontalRatio >= MIN_HORIZONTAL_RATIO;

    // Arms extended? Elbow flex < 18° on visible side.
    const flexDeg = elbowFlexionDeg(shoulder, elbow, wrist);
    const armsExtended = flexDeg < ARMS_EXTENDED_FLEX_MAX;

    // Distance via body length
    let distanceOk = true;
    let distanceHint: 'too-close' | 'too-far' | null = null;
    if (dx < MIN_BODY_LENGTH_X) {
      distanceOk = false;
      distanceHint = 'too-far';
    } else if (dx > MAX_BODY_LENGTH_X) {
      distanceOk = false;
      distanceHint = 'too-close';
    }

    const checks = {
      fullBodyVisible: true,
      feetWide: horizontal,         // remap meaning
      armsOverhead: armsExtended,   // remap meaning
      distanceOk,
    };

    if (!checks.feetWide || !checks.armsOverhead || !checks.distanceOk) {
      return { checks, distanceHint, baselineCandidate: null };
    }

    const baseline: PushupBaseline = {
      shoulderY: shoulder.y,
      hipY: hip.y,
      ankleY: ankle.y,
      side,
      bodyLength: dx,
      noseY: nose?.y ?? shoulder.y,
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
  getBaseline(): PushupBaseline | null { return this.confirmedBaseline; }
}
