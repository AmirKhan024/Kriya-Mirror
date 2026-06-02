/**
 * Star Pose calibration — 4 gates mirroring Single Leg Stand's shape, remapped
 * to the star stance:
 *   fullBodyVisible → shoulders+hips+knees+ankles+wrists visible
 *   feetWide        → legExtended (one ankle lifted AND feet spread wide laterally)
 *   armsOverhead    → armsUp (both wrists above shoulders — the literal star arms)
 *   distanceOk      → body span in frame
 *
 * Star pose is a SINGLE-LEG balance hold: stand on one leg, extend the other
 * leg out to the side, raise both arms into a star. The standing leg is the
 * planted (lower) foot; the extended leg is the lifted (higher), laterally
 * spread foot — auto-detected here.
 */
import type { PoseLandmarks } from '@/modules/pose/types';
import type { CalibrationBaseline, CalibrationUpdate } from '@/modules/squat/types';
import { LM, lmVisible } from './geometry';
import type { StarPoseBaseline } from './types';
import { debugLog } from '@/lib/debug';

// §3.5: confirm "instantly" once gates green — 200 ms ≈ a single 6-frame
// debounce against MediaPipe noise (NOT a 2 s hold).
const CONFIRM_DURATION_MS = 200;
const BAD_POSTURE_BUFFER_MS = 300;
const TIMEOUT_MS = 20000;

// Star stance detection. One ankle must be clearly higher (extended leg lifted)
// AND the feet must be clearly wider than the shoulders (leg spread to the
// side). Requiring BOTH avoids confusing a star with normal standing or a
// front knee-raise. (Y inverted: smaller y = higher in frame.)
const LEG_LIFT_RATIO = 0.12;      // |leftAnkle.y - rightAnkle.y| / shoulderWidth must exceed this
const LEG_LATERAL_RATIO = 1.30;   // |leftAnkle.x - rightAnkle.x| / shoulderWidth must exceed this

// Widened (physical test: the distance gate rejected good positions). Only
// clearly too-far / too-close is flagged now.
const BODY_HEIGHT_MIN = 0.35;
const BODY_HEIGHT_MAX = 1.00;

// Minimum shoulder width to lock a usable baseline. Every hold-detection
// threshold normalizes by baseline.shoulderWidth, so a tiny value (user at the
// frame edge / a shoulder poorly estimated) collapses the thresholds to within
// pixel-jitter. Treat as 'too-far' to surface the right hint.
const MIN_SHOULDER_WIDTH = 0.08;

const REQUIRED_LM = [
  LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER,
  LM.LEFT_HIP, LM.RIGHT_HIP,
  LM.LEFT_KNEE, LM.RIGHT_KNEE,
  LM.LEFT_ANKLE, LM.RIGHT_ANKLE,
  LM.LEFT_WRIST, LM.RIGHT_WRIST,
];

export class StarPoseCalibration {
  private startedAt: number;
  private goodPostureStart = 0;
  private badPostureStart = 0;
  private confirmedBaseline: StarPoseBaseline | null = null;
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
      debugLog('STAR', 'CALIB', `${prevState} → ${this.state}`, {
        gates: {
          fullBody: checks.fullBodyVisible,
          legExtended: checks.feetWide,
          armsUp: checks.armsOverhead,
          dist: checks.distanceOk,
        },
        distHint: distanceHint,
        liftedSide: baselineCandidate?.liftedSide,
      });
    }

    return this.makeUpdate();
  }

  private checkGates(landmarks: PoseLandmarks): {
    checks: CalibrationUpdate['checks'];
    distanceHint: 'too-close' | 'too-far' | null;
    baselineCandidate: StarPoseBaseline | null;
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
    const lh = landmarks[LM.LEFT_HIP];
    const rh = landmarks[LM.RIGHT_HIP];
    const la = landmarks[LM.LEFT_ANKLE];
    const ra = landmarks[LM.RIGHT_ANKLE];
    const lw = landmarks[LM.LEFT_WRIST];
    const rw = landmarks[LM.RIGHT_WRIST];

    const shoulderWidth = Math.abs(ls.x - rs.x);

    // Star stance: one ankle lifted (extended leg off floor) AND feet spread
    // wide laterally (leg out to the side). Y inverted: smaller y = higher.
    const ankleYDiff = Math.abs(la.y - ra.y);
    const ankleXSep = Math.abs(la.x - ra.x);
    const oneFootLifted = shoulderWidth > 0 && (ankleYDiff / shoulderWidth) > LEG_LIFT_RATIO;
    const feetSpreadWide = shoulderWidth > 0 && (ankleXSep / shoulderWidth) > LEG_LATERAL_RATIO;
    const legExtended = oneFootLifted && feetSpreadWide;
    // Extended leg = the higher (lifted) ankle; the planted (lower) leg stands.
    const liftedSide: 'left' | 'right' = la.y < ra.y ? 'left' : 'right';

    // Star arms: both wrists physically above shoulders (Y inverted).
    const armsUp = lw.y < ls.y && rw.y < rs.y;

    // Distance check (mirrors single-leg-stand / plank).
    const shoulderY = (ls.y + rs.y) / 2;
    const ankleYAvg = (la.y + ra.y) / 2;
    const bodyHeight = Math.abs(ankleYAvg - shoulderY);
    let distanceOk = true;
    let distanceHint: 'too-close' | 'too-far' | null = null;
    if (bodyHeight < BODY_HEIGHT_MIN || shoulderWidth < MIN_SHOULDER_WIDTH) {
      distanceOk = false;
      distanceHint = 'too-far';
    } else if (bodyHeight > BODY_HEIGHT_MAX) {
      distanceOk = false;
      distanceHint = 'too-close';
    }

    const checks = {
      fullBodyVisible: true,
      feetWide: legExtended,    // remap: "wide" slot → "leg extended into the star"
      armsOverhead: armsUp,     // remap: "overhead" slot → "both arms up in the star"
      distanceOk,
    };

    if (!checks.feetWide || !checks.armsOverhead || !checks.distanceOk) {
      return { checks, distanceHint, baselineCandidate: null };
    }

    const baseline: StarPoseBaseline = {
      comX: (lh.x + rh.x) / 2 * 0.6 + (ls.x + rs.x) / 2 * 0.4,
      comY: (lh.y + rh.y) / 2 * 0.6 + (ls.y + rs.y) / 2 * 0.4,
      shoulderWidth,
      liftedSide,
      standingAnkleY: liftedSide === 'left' ? ra.y : la.y,
      liftedAnkleY: liftedSide === 'left' ? la.y : ra.y,
      ankleXSep,
      shoulderY,
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
      baseline: this.confirmedBaseline ? toSquatBaseline(this.confirmedBaseline) : undefined,
    };
  }

  isConfirmed(): boolean { return this.state === 'confirmed'; }
  getBaseline(): StarPoseBaseline | null { return this.confirmedBaseline; }
}

/** Type-glue: shared `CalibrationUpdate.baseline` is typed as squat's baseline. */
function toSquatBaseline(b: StarPoseBaseline): CalibrationBaseline {
  return {
    shoulderMid: { x: b.comX, y: b.shoulderY },
    hipMid: { x: b.comX, y: b.comY },
    hipWidth: 0,
    shoulderWidth: b.shoulderWidth,
    torsoHeight: Math.abs(b.comY - b.shoulderY),
    ankleY: b.standingAnkleY,
    feetWidth: b.ankleXSep,
    feetVsShoulderRatio: 0,
    leftKneeX: b.comX,
    rightKneeX: b.comX,
  };
}
