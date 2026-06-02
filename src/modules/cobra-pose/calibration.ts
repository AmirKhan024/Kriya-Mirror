/**
 * Cobra Pose calibration — 4 gates, mirroring plank's side-profile shape so the
 * play-page overlay code is shared. Field meanings are remapped:
 *   fullBodyVisible → shoulder + hip + knee + ankle visible (camera side)
 *   feetWide        → prone (the hip→ankle lower body is roughly horizontal)
 *   armsOverhead    → chest lifted (torso elevation ≥ ELEV_CALIB_MIN)
 *   distanceOk      → horizontal body span |shoulderX − ankleX| (hysteresis + too-far floor)
 *
 * Calibration confirms IN the pose (like plank / chair-pose): the user lies prone,
 * lifts the chest, holds, and it confirms ~instantly (200 ms debounce).
 */
import type { PoseLandmarks } from '@/modules/pose/types';
import type { CalibrationUpdate } from '@/modules/squat/types';
import { LM, lmVisible } from '@/modules/squat/geometry';
import type { CobraPoseBaseline } from './types';
import { debugLog } from '@/lib/debug';

// 2026-05-25 round 5 (Fix G): instant confirm — 200 ms debounce, not 2000.
const CONFIRM_DURATION_MS = 200;
const BAD_POSTURE_BUFFER_MS = 300;
const TIMEOUT_MS = 20000;

// Chest must be lifted at least this far above horizontal.
const ELEV_CALIB_MIN = 18;
// Prone: the lower body (hip→ankle) must read as roughly horizontal so a
// standing chest-lift (where elevation would falsely read ~90°) is rejected.
const PRONE_HORIZONTAL_RATIO = 2.5; // |dx| / |dy| ≥ this → lying down

// Distance via horizontal body span |shoulderX − ankleX|, enter/exit hysteresis
// (Fix F). The MIN edge is the Fix X analog: too-small span = too far / poorly
// detected → reject as 'too-far'. (Runtime metric is a pure angle, so there is
// no distance normalizer to collapse — this gate is the only distance guard.)
const BODY_LEN_MIN_ENTER = 0.35;
const BODY_LEN_MAX_ENTER = 0.95;
const BODY_LEN_MIN_EXIT = 0.30;
const BODY_LEN_MAX_EXIT = 1.00;

/** Torso elevation: angle of the (shoulder → hip) segment above horizontal.
 *  ~0 when lying flat (shoulder level with hip); positive as the chest lifts
 *  (shoulder rises above the hip). */
function torsoElevationDeg(
  shoulder: { x: number; y: number },
  hip: { x: number; y: number },
): number {
  const rise = hip.y - shoulder.y;            // > 0 when shoulder is above hip
  const run = Math.abs(shoulder.x - hip.x);
  return Math.atan2(rise, Math.max(run, 1e-6)) * (180 / Math.PI);
}

export class CobraPoseCalibration {
  private startedAt: number;
  private goodPostureStart = 0;
  private badPostureStart = 0;
  private confirmedBaseline: CobraPoseBaseline | null = null;
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
      debugLog('COBRA', 'CALIB', `${prevState} → ${this.state}`, {
        gates: {
          sideProfile: checks.fullBodyVisible,
          prone: checks.feetWide,
          chestLifted: checks.armsOverhead,
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
    baselineCandidate: CobraPoseBaseline | null;
  } {
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

    // Prone: the lower body (hip→ankle) is roughly horizontal.
    const legDx = Math.abs(ankle.x - hip.x);
    const legDy = Math.abs(ankle.y - hip.y);
    const prone = legDx / Math.max(legDy, 1e-6) >= PRONE_HORIZONTAL_RATIO;

    // Chest lifted: torso elevation above horizontal.
    const elevation = torsoElevationDeg(shoulder, hip);
    const chestLifted = elevation >= ELEV_CALIB_MIN;

    // Distance via horizontal body span, with hysteresis.
    const bodyLengthX = Math.abs(shoulder.x - ankle.x);
    const min = this.distInBand ? BODY_LEN_MIN_EXIT : BODY_LEN_MIN_ENTER;
    const max = this.distInBand ? BODY_LEN_MAX_EXIT : BODY_LEN_MAX_ENTER;
    let distanceOk = true;
    let distanceHint: 'too-close' | 'too-far' | null = null;
    if (bodyLengthX < min) {
      distanceOk = false;
      distanceHint = 'too-far';
    } else if (bodyLengthX > max) {
      distanceOk = false;
      distanceHint = 'too-close';
    }
    this.distInBand = distanceOk;

    const checks = {
      fullBodyVisible: true,
      feetWide: prone,             // remap: "wide" slot → "lying prone"
      armsOverhead: chestLifted,   // remap: "overhead" slot → "chest lifted"
      distanceOk,
    };

    if (!checks.feetWide || !checks.armsOverhead || !checks.distanceOk) {
      return { checks, distanceHint, baselineCandidate: null };
    }

    const baseline: CobraPoseBaseline = {
      side,
      shoulderY: shoulder.y,
      hipY: hip.y,
      bodyLengthX,
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
      // Baseline read internally via getBaseline() (like plank) — the shared
      // CalibrationUpdate.baseline shape assumes squat's front-facing fields.
    };
  }

  isConfirmed(): boolean { return this.state === 'confirmed'; }
  getBaseline(): CobraPoseBaseline | null { return this.confirmedBaseline; }
}
