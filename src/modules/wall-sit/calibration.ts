/**
 * Wall Sit calibration — 4 gates, side-facing camera.
 *
 * Mirrors chair-pose's gate-shape (the play-page overlay reads
 * `checks.fullBodyVisible / feetWide / armsOverhead / distanceOk`). Field
 * meanings remapped for the wall-sit-against-a-wall position:
 *   fullBodyVisible → side shoulder+hip+knee+ankle all visible
 *   feetWide        → kneesBent (knee flexion within the wall-sit band, ~90°)
 *   armsOverhead    → backUpright (trunk near-vertical, i.e. back flat on the
 *                     wall). Wall sit does NOT gate arm position — the back
 *                     being vertical is the signature cue, so that's the gate.
 *   distanceOk      → body height (ankle-Y minus shoulder-Y) within band, with
 *                     hysteresis (Fix F) and a "too-far" floor (Fix X analog
 *                     for side-on pose — shoulder-width is naturally tiny when
 *                     rotated 90° to the camera, so bodyHeight is the reference).
 */
import type { PoseLandmarks } from '@/modules/pose/types';
import type { CalibrationUpdate } from '@/modules/squat/types';
import { LM, lmVisible, kneeFlexionDeg, trunkLeanDeg } from '@/modules/squat/geometry';
import type { WallSitBaseline } from './types';
import { debugLog } from '@/lib/debug';

// Fix G: instant calibration — confirms ~6 frames after all gates go green.
const CONFIRM_DURATION_MS = 200;
const BAD_POSTURE_BUFFER_MS = 300;
// Fix J: calibration timeout.
const TIMEOUT_MS = 20_000;

// "Sitting against the wall" gate, WITH hysteresis (2026-05-31 physical-test
// fix). The knee-flex read jitters near the threshold under side-view leg
// occlusion, which made the checklist flicker true↔false and could lock a
// shallow baseline. Enter the gate only at a clearly-deep ENTER angle, then hold
// it until the read drops below the looser EXIT angle.
const MIN_KNEE_FLEX_ENTER = 62;
const MIN_KNEE_FLEX_EXIT = 52;
// Above this at cal-time = sitting too deep (hips well below knees). Reject so
// we don't lock a collapsed baseline.
const MAX_KNEE_FLEX_FOR_HOLD = 130;

// Back must be near-vertical at calibration (flat against the wall). Tighter
// than chair pose (which allows a forward hinge) because the defining cue of a
// wall sit is the upright back.
const MAX_BACK_LEAN_AT_CAL_DEG = 20;

// Fix F: distance hysteresis. Side-facing pose uses body HEIGHT (Y span from
// ankle to shoulder) as the distance reference — body-X-span is small because
// the user is rotated.
const MIN_BODY_HEIGHT_ENTER = 0.45;
const MAX_BODY_HEIGHT_ENTER = 0.88;
const MIN_BODY_HEIGHT_EXIT = 0.40;   // ~11% looser on the "too-far" side
const MAX_BODY_HEIGHT_EXIT = 0.93;   // ~5% looser on the "too-close" side

// Fix X analog for side-on pose: bodyHeight floor below which the baseline
// would be degenerate. MUST be ≤ MIN_BODY_HEIGHT_ENTER so the gate catches it.
const MIN_BODY_HEIGHT_RUNTIME = 0.30;

export class WallSitCalibration {
  private startedAt: number;
  private goodPostureStart = 0;
  private badPostureStart = 0;
  private confirmedBaseline: WallSitBaseline | null = null;
  private state: 'waiting' | 'good' | 'confirmed' | 'timeout' = 'waiting';
  private lastChecks: CalibrationUpdate['checks'] = {
    fullBodyVisible: false, feetWide: false, armsOverhead: false, distanceOk: false,
  };
  private lastDistanceHint: 'too-close' | 'too-far' | null = null;
  // Fix F: persisted band-membership so hysteresis applies across frames.
  private distInBand = false;
  // 2026-05-31: persisted knees-bent membership for the enter/exit hysteresis.
  private kneesInBand = false;

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
      debugLog('WALLSIT', 'CALIB', `${prevState} → ${this.state}`, {
        gates: {
          sideProfile: checks.fullBodyVisible,
          kneesBent: checks.feetWide,
          backUpright: checks.armsOverhead,
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
    baselineCandidate: WallSitBaseline | null;
  } {
    const ls = landmarks[LM.LEFT_SHOULDER];
    const rs = landmarks[LM.RIGHT_SHOULDER];
    const lh = landmarks[LM.LEFT_HIP];
    const rh = landmarks[LM.RIGHT_HIP];
    const lk = landmarks[LM.LEFT_KNEE];
    const rk = landmarks[LM.RIGHT_KNEE];
    const la = landmarks[LM.LEFT_ANKLE];
    const ra = landmarks[LM.RIGHT_ANKLE];

    // Pick the side with better visibility on the side-on critical chain.
    const leftScore = (ls?.visibility ?? 0) + (lh?.visibility ?? 0)
      + (lk?.visibility ?? 0) + (la?.visibility ?? 0);
    const rightScore = (rs?.visibility ?? 0) + (rh?.visibility ?? 0)
      + (rk?.visibility ?? 0) + (ra?.visibility ?? 0);
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

    // Knee flexion at calibration. squat/geometry: 0° = straight, ~90° = parallel.
    // Enter/exit hysteresis stops the checklist flickering under side-view jitter.
    const kneeFlex = kneeFlexionDeg(hip, knee, ankle);
    const kneeEnter = this.kneesInBand ? MIN_KNEE_FLEX_EXIT : MIN_KNEE_FLEX_ENTER;
    const kneesBent = kneeFlex >= kneeEnter && kneeFlex <= MAX_KNEE_FLEX_FOR_HOLD;
    this.kneesInBand = kneesBent;

    // Back upright: trunk near-vertical (back flat against the wall). Side-on, so
    // the single visible shoulder/hip stand in for the midpoints.
    const trunkDeg = trunkLeanDeg({ x: shoulder.x, y: shoulder.y }, { x: hip.x, y: hip.y });
    const backUpright = trunkDeg <= MAX_BACK_LEAN_AT_CAL_DEG;

    // Distance via body height in Y, with hysteresis (Fix F + H).
    const bodyHeight = Math.abs(ankle.y - shoulder.y);
    const min = this.distInBand ? MIN_BODY_HEIGHT_EXIT : MIN_BODY_HEIGHT_ENTER;
    const max = this.distInBand ? MAX_BODY_HEIGHT_EXIT : MAX_BODY_HEIGHT_ENTER;
    let distanceOk = true;
    let distanceHint: 'too-close' | 'too-far' | null = null;
    if (bodyHeight < min) {
      distanceOk = false;
      distanceHint = 'too-far';
    } else if (bodyHeight > max) {
      distanceOk = false;
      distanceHint = 'too-close';
    }
    // Fix X analog for side-on: explicit floor reject so a degenerate baseline
    // (every distance-normalized threshold collapsing to noise) surfaces as
    // too-far for the user to step closer.
    if (bodyHeight < MIN_BODY_HEIGHT_RUNTIME) {
      distanceOk = false;
      distanceHint = 'too-far';
    }
    this.distInBand = distanceOk;

    const checks = {
      fullBodyVisible: true,
      feetWide: kneesBent,        // remap: knees bent into the wall sit
      armsOverhead: backUpright,  // remap: back flat/upright against the wall
      distanceOk,
    };

    if (!checks.feetWide || !checks.armsOverhead || !checks.distanceOk) {
      return { checks, distanceHint, baselineCandidate: null };
    }

    const baseline: WallSitBaseline = {
      side,
      shoulderY: shoulder.y,
      hipY: hip.y,
      kneeY: knee.y,
      ankleY: ankle.y,
      bodyHeight,
      initialKneeFlexionDeg: kneeFlex,
      initialTrunkLeanDeg: trunkDeg,
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
  getBaseline(): WallSitBaseline | null { return this.confirmedBaseline; }
}
