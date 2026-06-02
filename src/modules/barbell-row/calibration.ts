/**
 * Barbell Row calibration — side camera, person in bent-over working position.
 *
 * The user calibrates in the bent-over (~45°) row stance, NOT standing upright.
 * This differs from the deadlift calibration (standing) — here we wait for the
 * user to hinge into the working position and hold still.
 *
 * Gates:
 *   fullBodyVisible → camera-side shoulder+hip+knee+ankle all visible
 *   feetWide        → remapped: bent-over position (hip hinge 35–65°)
 *   armsOverhead    → remapped: arms hanging straight down (elbow ≥ 140°, arms not mid-row)
 *   distanceOk      → body height in frame within acceptable range (with hysteresis)
 */
import type { PoseLandmarks } from '@/modules/pose/types';
import { LM, lmVisible, hipHingeDeg, elbowFlexionDeg } from './geometry';
import type { RowBaseline } from './types';
import type { CalibrationBaseline, CalibrationState, CalibrationUpdate } from '@/modules/squat/types';
import { debugLog } from '@/lib/debug';

// Fix G: instant confirm once all gates green
const CONFIRM_DURATION_MS = 200;
const BAD_POSTURE_BUFFER_MS = 300;
const TIMEOUT_MS = 30_000;

// Working position: torso must be bent over by these degrees
// Fix F: separate enter/exit hysteresis
const HINGE_MIN_ENTER = 35;
const HINGE_MAX_ENTER = 65;
const HINGE_MIN_EXIT = 30;
const HINGE_MAX_EXIT = 70;

// Arms hanging: elbowFlexionDeg (180° - interior angle) should be SMALL when arms hang straight.
// elbowFlexionDeg ≈ 0° = collinear (perfectly straight)
// elbowFlexionDeg ≈ 120° = fully mid-row (elbow driven way up)
// We allow up to 50° deviation — user's arms should be mostly straight/hanging.
const ARMS_HANGING_MAX_FLEX = 50;   // elbowFlexionDeg <= this = arms hanging (not mid-row)

// Body height (shoulder.y to ankle.y) in frame — acceptable range.
// Hysteresis: entering the band requires stricter thresholds than staying in it.
// For bent-over position, the shoulder is closer to hip/ankle, so the effective
// "body height" captured in frame is smaller than standing.
const BODY_HEIGHT_MIN_ENTER = 0.45;
const BODY_HEIGHT_MAX_ENTER = 0.90;
const BODY_HEIGHT_MIN_EXIT = 0.40;
const BODY_HEIGHT_MAX_EXIT = 0.92;

export class RowCalibration {
  private startedAt: number;
  private goodPostureStart = 0;
  private badPostureStart = 0;
  private confirmedBaseline: RowBaseline | null = null;
  private state: CalibrationState = 'waiting';
  private lastChecks: CalibrationUpdate['checks'] = {
    fullBodyVisible: false, feetWide: false, armsOverhead: false, distanceOk: false,
  };
  private lastDistanceHint: 'too-close' | 'too-far' | null = null;
  private distInBand = false;
  private hingeInBand = false;

  constructor() {
    this.startedAt = -1; // seeded from first update() call
  }

  update(landmarks: PoseLandmarks | null, now: number): CalibrationUpdate {
    if (this.startedAt < 0) this.startedAt = now;

    if (this.state === 'confirmed') {
      return {
        state: this.state,
        progressMs: CONFIRM_DURATION_MS,
        checks: this.lastChecks,
        distanceHint: null,
        baseline: this.confirmedBaseline ? toSquatBaseline(this.confirmedBaseline) : undefined,
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
      return this.makeUpdate(now);
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
      debugLog('ROW', 'CALIB', `${prevState} → ${this.state}`, {
        gates: {
          fullBody: checks.fullBodyVisible,
          bentOver: checks.feetWide,
          armsHanging: checks.armsOverhead,
          dist: checks.distanceOk,
        },
        distHint: distanceHint,
      });
    }

    return this.makeUpdate(now);
  }

  private checkGates(landmarks: PoseLandmarks): {
    checks: CalibrationUpdate['checks'];
    distanceHint: 'too-close' | 'too-far' | null;
    baselineCandidate: RowBaseline | null;
  } {
    // Pick the side with better shoulder+hip+ankle visibility
    const ls = landmarks[LM.LEFT_SHOULDER];
    const rs = landmarks[LM.RIGHT_SHOULDER];
    const lh = landmarks[LM.LEFT_HIP];
    const rh = landmarks[LM.RIGHT_HIP];
    const la = landmarks[LM.LEFT_ANKLE];
    const ra = landmarks[LM.RIGHT_ANKLE];
    const lk = landmarks[LM.LEFT_KNEE];
    const rk = landmarks[LM.RIGHT_KNEE];
    const le = landmarks[LM.LEFT_ELBOW];
    const re = landmarks[LM.RIGHT_ELBOW];
    const lw = landmarks[LM.LEFT_WRIST];
    const rw = landmarks[LM.RIGHT_WRIST];

    const leftScore = (ls?.visibility ?? 0) + (lh?.visibility ?? 0) + (la?.visibility ?? 0);
    const rightScore = (rs?.visibility ?? 0) + (rh?.visibility ?? 0) + (ra?.visibility ?? 0);
    const side: 'left' | 'right' = leftScore >= rightScore ? 'left' : 'right';

    const shoulder = side === 'left' ? ls : rs;
    const hip = side === 'left' ? lh : rh;
    const knee = side === 'left' ? lk : rk;
    const ankle = side === 'left' ? la : ra;
    const elbow = side === 'left' ? le : re;
    const wrist = side === 'left' ? lw : rw;

    const fullBodyVisible = lmVisible(shoulder) && lmVisible(hip) && lmVisible(knee) && lmVisible(ankle);
    if (!fullBodyVisible) {
      return {
        checks: { fullBodyVisible: false, feetWide: false, armsOverhead: false, distanceOk: false },
        distanceHint: null,
        baselineCandidate: null,
      };
    }

    // Bent-over position: hip hinge in [35°, 65°] (Fix F: hysteresis)
    const hingeDeg = hipHingeDeg(shoulder, hip, knee);
    const hingeMin = this.hingeInBand ? HINGE_MIN_EXIT : HINGE_MIN_ENTER;
    const hingeMax = this.hingeInBand ? HINGE_MAX_EXIT : HINGE_MAX_ENTER;
    const bentOver = hingeDeg >= hingeMin && hingeDeg <= hingeMax;
    this.hingeInBand = bentOver;

    // Arms hanging: elbowFlexionDeg should be small (arms mostly straight, not mid-row)
    // elbowFlexionDeg = 180° - interior angle at elbow, so straight arms ≈ 0°
    let armsHanging = true;
    if (lmVisible(elbow) && lmVisible(wrist)) {
      const flex = elbowFlexionDeg(shoulder, elbow, wrist);
      armsHanging = flex <= ARMS_HANGING_MAX_FLEX;
    }

    // Distance via body height in y (shoulder-to-ankle span)
    // Fix H: always emit distanceHint
    const bodyHeight = Math.abs(ankle.y - shoulder.y);
    const distMin = this.distInBand ? BODY_HEIGHT_MIN_EXIT : BODY_HEIGHT_MIN_ENTER;
    const distMax = this.distInBand ? BODY_HEIGHT_MAX_EXIT : BODY_HEIGHT_MAX_ENTER;
    let distanceOk = true;
    let distanceHint: 'too-close' | 'too-far' | null = null;
    if (bodyHeight < distMin) {
      distanceOk = false;
      distanceHint = 'too-far';
    } else if (bodyHeight > distMax) {
      distanceOk = false;
      distanceHint = 'too-close';
    }
    this.distInBand = distanceOk;

    const checks = {
      fullBodyVisible: true,
      feetWide: bentOver,         // remap: "wide" slot = "bent-over position confirmed"
      armsOverhead: armsHanging,  // remap: "overhead" slot = "arms hanging straight"
      distanceOk,
    };

    if (!checks.feetWide || !checks.armsOverhead || !checks.distanceOk) {
      return { checks, distanceHint, baselineCandidate: null };
    }

    const baseline: RowBaseline = {
      shoulderY: shoulder.y,
      hipY: hip.y,
      kneeY: knee.y,
      ankleY: ankle.y,
      hipHingeDegAtCal: hingeDeg,
      side,
      bodyLengthY: bodyHeight,
      shoulderX: shoulder.x,
      hipX: hip.x,
    };
    return { checks, distanceHint, baselineCandidate: baseline };
  }

  private resetProgress() {
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
      baseline: this.confirmedBaseline ? toSquatBaseline(this.confirmedBaseline) : undefined,
    };
  }

  isConfirmed(): boolean { return this.state === 'confirmed'; }
  getBaseline(): RowBaseline | null { return this.confirmedBaseline; }
}

/** Adapt RowBaseline to the shared CalibrationBaseline shape the play page reads. */
function toSquatBaseline(b: RowBaseline): CalibrationBaseline {
  return {
    shoulderMid: { x: b.shoulderX, y: b.shoulderY },
    hipMid: { x: b.hipX, y: b.hipY },
    shoulderWidth: 0,
    hipWidth: 0,
    torsoHeight: Math.abs(b.hipY - b.shoulderY),
    ankleY: b.ankleY,
    feetWidth: 0,
    feetVsShoulderRatio: 0,
    leftKneeX: b.hipX,
    rightKneeX: b.hipX,
  };
}
