/**
 * Seated Forward Fold calibration — 4 gates, side profile, remapped onto the
 * shared plank-shaped `checks` so the play-page overlay code is reused:
 *   fullBodyVisible → camera-side shoulder + hip + knee + ankle visible
 *   feetWide        → legs extended on the floor (hip→ankle roughly horizontal)
 *   armsOverhead    → folded forward (torso fold angle ≥ FOLD_CALIB_MIN)
 *   distanceOk      → leg span |hipX − ankleX| (hysteresis + too-far floor)
 *
 * Calibration confirms IN the pose (long-sitting, legs out, torso folded over
 * them), like cobra / standing-forward-fold. The "legs extended on the floor"
 * gate rejects a standing person (legs vertical) so the engine only activates
 * for someone actually sitting on the floor with their legs out.
 */
import type { PoseLandmarks } from '@/modules/pose/types';
import type { CalibrationUpdate } from '@/modules/squat/types';
import { LM, lmVisible, trunkLeanDeg } from '@/modules/squat/geometry';
import type { SeatedForwardFoldBaseline } from './types';
import { debugLog } from '@/lib/debug';

// 2026-05-25 round 5 (Fix G): instant confirm — 200 ms debounce, not 2000.
const CONFIRM_DURATION_MS = 200;
const BAD_POSTURE_BUFFER_MS = 300;
const TIMEOUT_MS = 20000;

// Legs extended on the floor: hip→ankle is roughly horizontal.
const LEGS_HORIZONTAL_RATIO = 2.5; // |dx| / |dy| ≥ this → legs out along the floor
// Folded forward: torso fold angle from vertical. 2026-06-02 physical-test fix
// (round 2): lowered 30 → 18. Probe logs show the owner's comfortable
// "fingers-to-toes" fold reads ~22–28°; 30 forced a strained deep fold. 18
// confirms a slight toe-touch fold with margin while sitting tall (~0–15°) is
// still rejected (the 200 ms sustain + legs-extended gate block a transient lean).
const FOLD_CALIB_MIN_DEG = 18;

// Distance proxy (2026-06-02 physical-test fix): the old `|hipX − ankleX|`
// horizontal leg span foreshortened to a false "too far" whenever the user sat
// even slightly angled to the side camera (and moving closer couldn't fix
// foreshortening). Use max(legXSpan, verticalBodyExtent) — the vertical extent
// (shoulder above the floor) is orientation-invariant — with a lower floor.
// Enter/exit hysteresis (Fix F). The MIN edge is the too-far guard.
const DIST_MIN_ENTER = 0.16;
const DIST_MAX_ENTER = 1.00;
const DIST_MIN_EXIT = 0.12;
const DIST_MAX_EXIT = 1.05;

export class SeatedForwardFoldCalibration {
  private startedAt: number;
  private goodPostureStart = 0;
  private badPostureStart = 0;
  private confirmedBaseline: SeatedForwardFoldBaseline | null = null;
  private state: 'waiting' | 'good' | 'confirmed' | 'timeout' = 'waiting';
  private lastChecks: CalibrationUpdate['checks'] = {
    fullBodyVisible: false, feetWide: false, armsOverhead: false, distanceOk: false,
  };
  private lastDistanceHint: 'too-close' | 'too-far' | null = null;
  private distInBand = false;
  private lastProbeAt = 0;

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

    const { checks, distanceHint, baselineCandidate } = this.checkGates(landmarks, now);
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
      debugLog('SFOLD', 'CALIB', `${prevState} → ${this.state}`, {
        gates: {
          sideProfile: checks.fullBodyVisible,
          legsExtended: checks.feetWide,
          folded: checks.armsOverhead,
          dist: checks.distanceOk,
        },
        distHint: distanceHint,
        side: baselineCandidate?.side,
      });
    }

    return this.makeUpdate();
  }

  private checkGates(landmarks: PoseLandmarks, now: number): {
    checks: CalibrationUpdate['checks'];
    distanceHint: 'too-close' | 'too-far' | null;
    baselineCandidate: SeatedForwardFoldBaseline | null;
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

    // Legs extended on the floor: hip→ankle roughly horizontal.
    const legDx = Math.abs(ankle.x - hip.x);
    const legDy = Math.abs(ankle.y - hip.y);
    const legsExtended = legDx / Math.max(legDy, 1e-6) >= LEGS_HORIZONTAL_RATIO;

    // Folded forward: torso fold angle from vertical.
    const foldAngle = trunkLeanDeg({ x: shoulder.x, y: shoulder.y }, { x: hip.x, y: hip.y });
    const folded = foldAngle >= FOLD_CALIB_MIN_DEG;

    // Distance: orientation-robust proxy. max(horizontal leg span, vertical body
    // extent). The vertical extent (shoulder above the floor-level ankle) does
    // not foreshorten when the legs angle toward/away from the side camera.
    const legX = Math.abs(hip.x - ankle.x);
    const vert = Math.abs(shoulder.y - ankle.y);
    const distProxy = Math.max(legX, vert);
    const min = this.distInBand ? DIST_MIN_EXIT : DIST_MIN_ENTER;
    const max = this.distInBand ? DIST_MAX_EXIT : DIST_MAX_ENTER;
    let distanceOk = true;
    let distanceHint: 'too-close' | 'too-far' | null = null;
    if (distProxy < min) {
      distanceOk = false;
      distanceHint = 'too-far';
    } else if (distProxy > max) {
      distanceOk = false;
      distanceHint = 'too-close';
    }
    this.distInBand = distanceOk;

    // 2026-06-02: throttled raw-value probe so a failing calibration is
    // self-diagnosing in the console (the state-change log only shows booleans).
    if (now - this.lastProbeAt >= 1000) {
      this.lastProbeAt = now;
      debugLog('SFOLD', 'CALIB', 'probe', {
        fold: +foldAngle.toFixed(1),
        legX: +legX.toFixed(3),
        vert: +vert.toFixed(3),
        distProxy: +distProxy.toFixed(3),
        gates: { legsExtended, folded, dist: distanceOk },
        distHint: distanceHint,
      });
    }

    const checks = {
      fullBodyVisible: true,
      feetWide: legsExtended,    // remap: "wide" slot → "legs extended on the floor"
      armsOverhead: folded,      // remap: "overhead" slot → "folded forward"
      distanceOk,
    };

    if (!checks.feetWide || !checks.armsOverhead || !checks.distanceOk) {
      return { checks, distanceHint, baselineCandidate: null };
    }

    const baseline: SeatedForwardFoldBaseline = {
      side,
      shoulderY: shoulder.y,
      hipY: hip.y,
      bodyLengthX: distProxy,
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
      // Baseline read internally via getBaseline() (like cobra/fold) — the shared
      // CalibrationUpdate.baseline shape assumes squat's front-facing fields.
    };
  }

  isConfirmed(): boolean { return this.state === 'confirmed'; }
  getBaseline(): SeatedForwardFoldBaseline | null { return this.confirmedBaseline; }
}
