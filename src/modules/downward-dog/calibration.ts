/**
 * Downward Dog calibration — 4 gates, mirroring plank's side-profile shape so
 * the play-page overlay code is shared. Field meanings are remapped:
 *   fullBodyVisible → shoulder + hip + knee + ankle + wrist visible (camera side)
 *   feetWide        → hips are the apex (hip clearly above shoulder AND ankle)
 *   armsOverhead    → sharp inverted V (hip apex angle under APEX_CALIB_MAX)
 *   distanceOk      → vertical leg drop |ankleY − hipY| in frame (hysteresis + too-far floor)
 *
 * Calibration confirms IN the pose (like plank / chair-pose): the user lifts
 * into the inverted V, holds, and it confirms ~instantly (200 ms debounce).
 */
import type { PoseLandmarks, NormalizedLandmark } from '@/modules/pose/types';
import type { CalibrationUpdate } from '@/modules/squat/types';
import { LM, lmVisible, kneeFlexionDeg } from '@/modules/squat/geometry';
import type { DownwardDogBaseline } from './types';
import { debugLog } from '@/lib/debug';

// 2026-05-25 round 5 (Fix G): instant confirm — 200 ms debounce, not 2000.
const CONFIRM_DURATION_MS = 200;
const BAD_POSTURE_BUFFER_MS = 300;
const TIMEOUT_MS = 20000;

// Inverted-V gates.
const APEX_CALIB_MAX = 110;   // hip apex angle must be at least this sharp
const APEX_MARGIN = 0.05;     // hip Y must sit this far above shoulder Y AND ankle Y

// Distance via vertical leg drop (|ankleY − hipY|), enter/exit hysteresis
// (Fix F). The MIN edge is the Fix X analog: too-small drop = too far / poorly
// detected → reject as 'too-far'. (Runtime metric is a pure angle, so there is
// no distance normalizer to collapse — this gate is the only distance guard.)
const LEG_DROP_MIN_ENTER = 0.18;
const LEG_DROP_MAX_ENTER = 0.55;
const LEG_DROP_MIN_EXIT = 0.15;
const LEG_DROP_MAX_EXIT = 0.60;

/** Hip apex interior angle (~90 = sharp inverted V, →180 = flat). Reuses
 *  squat's joint-angle helper: kneeFlexionDeg(a, vertex, b) returns
 *  180 − interiorAngle(vertex), so the interior angle at the hip is its
 *  complement. */
function hipApexAngleDeg(
  shoulder: NormalizedLandmark,
  hip: NormalizedLandmark,
  ankle: NormalizedLandmark,
): number {
  return 180 - kneeFlexionDeg(shoulder, hip, ankle);
}

export class DownwardDogCalibration {
  private startedAt: number;
  private goodPostureStart = 0;
  private badPostureStart = 0;
  private confirmedBaseline: DownwardDogBaseline | null = null;
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
      debugLog('DOG', 'CALIB', `${prevState} → ${this.state}`, {
        gates: {
          sideProfile: checks.fullBodyVisible,
          hipsApex: checks.feetWide,
          sharpV: checks.armsOverhead,
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
    baselineCandidate: DownwardDogBaseline | null;
  } {
    const ls = landmarks[LM.LEFT_SHOULDER];
    const rs = landmarks[LM.RIGHT_SHOULDER];
    const lh = landmarks[LM.LEFT_HIP];
    const rh = landmarks[LM.RIGHT_HIP];
    const lk = landmarks[LM.LEFT_KNEE];
    const rk = landmarks[LM.RIGHT_KNEE];
    const la = landmarks[LM.LEFT_ANKLE];
    const ra = landmarks[LM.RIGHT_ANKLE];
    const lw = landmarks[LM.LEFT_WRIST];
    const rw = landmarks[LM.RIGHT_WRIST];

    const leftScore = (ls?.visibility ?? 0) + (lh?.visibility ?? 0) + (lk?.visibility ?? 0)
      + (la?.visibility ?? 0) + (lw?.visibility ?? 0);
    const rightScore = (rs?.visibility ?? 0) + (rh?.visibility ?? 0) + (rk?.visibility ?? 0)
      + (ra?.visibility ?? 0) + (rw?.visibility ?? 0);
    const side: 'left' | 'right' = leftScore >= rightScore ? 'left' : 'right';

    const shoulder = side === 'left' ? ls : rs;
    const hip = side === 'left' ? lh : rh;
    const knee = side === 'left' ? lk : rk;
    const ankle = side === 'left' ? la : ra;
    const wrist = side === 'left' ? lw : rw;

    const fullBodyVisible = lmVisible(shoulder) && lmVisible(hip) && lmVisible(knee)
      && lmVisible(ankle) && lmVisible(wrist);
    if (!fullBodyVisible) {
      return {
        checks: { fullBodyVisible: false, feetWide: false, armsOverhead: false, distanceOk: false },
        distanceHint: null,
        baselineCandidate: null,
      };
    }

    // Hips are the apex: hip sits clearly above (smaller y than) shoulder AND ankle.
    const hipsApex = hip.y < shoulder.y - APEX_MARGIN && hip.y < ankle.y - APEX_MARGIN;

    // Sharp inverted V: hip apex angle below the calibration max.
    const apexAngle = hipApexAngleDeg(shoulder, hip, ankle);
    const sharpV = apexAngle <= APEX_CALIB_MAX;

    // Distance via vertical leg drop, with hysteresis.
    const legDropY = Math.abs(ankle.y - hip.y);
    const min = this.distInBand ? LEG_DROP_MIN_EXIT : LEG_DROP_MIN_ENTER;
    const max = this.distInBand ? LEG_DROP_MAX_EXIT : LEG_DROP_MAX_ENTER;
    let distanceOk = true;
    let distanceHint: 'too-close' | 'too-far' | null = null;
    if (legDropY < min) {
      distanceOk = false;
      distanceHint = 'too-far';
    } else if (legDropY > max) {
      distanceOk = false;
      distanceHint = 'too-close';
    }
    this.distInBand = distanceOk;

    const checks = {
      fullBodyVisible: true,
      feetWide: hipsApex,       // remap: "wide" slot → "hips are the apex"
      armsOverhead: sharpV,     // remap: "overhead" slot → "sharp inverted V"
      distanceOk,
    };

    if (!checks.feetWide || !checks.armsOverhead || !checks.distanceOk) {
      return { checks, distanceHint, baselineCandidate: null };
    }

    const baseline: DownwardDogBaseline = {
      side,
      hipY: hip.y,
      ankleY: ankle.y,
      legDropY,
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
  getBaseline(): DownwardDogBaseline | null { return this.confirmedBaseline; }
}
