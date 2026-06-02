/**
 * Superman calibration — side camera, prone position.
 * The person lies face-down with arms extended overhead, legs straight.
 *
 * Reuses the squat CalibrationUpdate shape so the play-page overlay component
 * is shared. Field meanings are remapped:
 *   fullBodyVisible → shoulder+hip+knee+ankle all visible on dominant side
 *   feetWide        → body horizontal (|dx|/|dy| >= 3.0) AND hips down (hip near floor Y)
 *   armsOverhead    → arms extended forward (wrist.x < shoulder.x OR wrist roughly ahead)
 *   distanceOk      → horizontal body span between 0.35 and 0.75
 */
import type { PoseLandmarks } from '@/modules/pose/types';
import type { CalibrationUpdate, CalibrationBaseline } from '@/modules/squat/types';
import { LM, lmVisible } from '@/modules/squat/geometry';
import type { SupermanBaseline } from './types';
import { debugLog } from '@/lib/debug';

// Fix G: instant confirm ~6-frame debounce against MediaPipe single-frame noise.
const CONFIRM_DURATION_MS = 200;
const BAD_POSTURE_BUFFER_MS = 300;
const TIMEOUT_MS = 20000;

const MIN_HORIZONTAL_RATIO = 3.0; // |dx| / |dy| >= 3.0 → roughly horizontal
const HIPS_DOWN_THRESHOLD = 0.04; // hip must be at floor level (hip.y close to baseline)
const ARMS_FORWARD_OFFSET = 0.06; // wrist.x must be < shoulder.x - 0.06 (arms extended ahead)

// Fix F: distance hint hysteresis
const MIN_BODY_LENGTH_X_ENTER = 0.37; // below this = 'too-far'
const MIN_BODY_LENGTH_X_EXIT  = 0.40; // must exceed this to clear 'too-far'
const MAX_BODY_LENGTH_X_ENTER = 0.73; // above this = 'too-close'
const MAX_BODY_LENGTH_X_EXIT  = 0.70; // must drop below this to clear 'too-close'

export class SupermanCalibration {
  private startedAt: number;
  private goodPostureStart = 0;
  private badPostureStart = 0;
  private confirmedBaseline: SupermanBaseline | null = null;
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
      debugLog('SUPERMAN', 'CALIB', `${prevState} → ${this.state}`, {
        gates: {
          sideProfile: checks.fullBodyVisible,
          horizontal: checks.feetWide,
          armsForward: checks.armsOverhead,
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
    baselineCandidate: SupermanBaseline | null;
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

    // Side detection: whichever side has higher sum of landmark visibilities
    const leftScore = (ls?.visibility ?? 0) + (lh?.visibility ?? 0)
      + (lk?.visibility ?? 0) + (la?.visibility ?? 0);
    const rightScore = (rs?.visibility ?? 0) + (rh?.visibility ?? 0)
      + (rk?.visibility ?? 0) + (ra?.visibility ?? 0);
    const side: 'left' | 'right' = leftScore >= rightScore ? 'left' : 'right';

    const shoulder = side === 'left' ? ls : rs;
    const hip      = side === 'left' ? lh : rh;
    const knee     = side === 'left' ? lk : rk;
    const ankle    = side === 'left' ? la : ra;
    const wrist    = side === 'left' ? lw : rw;

    // Gate 1: all key landmarks visible on the dominant side
    const fullBodyVisible = lmVisible(shoulder) && lmVisible(hip)
      && lmVisible(knee) && lmVisible(ankle);

    if (!fullBodyVisible) {
      return {
        checks: { fullBodyVisible: false, feetWide: false, armsOverhead: false, distanceOk: false },
        distanceHint: null,
        baselineCandidate: null,
      };
    }

    // Gate 2 (feetWide slot): torso horizontal (shoulder and hip at same floor level)
    // AND hips are down (on the floor, not raised).
    // Use shoulder→hip for horizontal ratio.
    const torsoX = Math.abs(hip.x - shoulder.x);
    const torsoY = Math.abs(hip.y - shoulder.y);
    const horizontalRatio = torsoY > 0.001 ? torsoX / torsoY : 999;
    const isHorizontal = horizontalRatio >= MIN_HORIZONTAL_RATIO;
    // For prone: hips should be at floor level — hip.y should be in the lower portion (≥ 0.60)
    const hipsDown = hip.y >= 0.60;
    const horizontal = isHorizontal && hipsDown;

    // Distance gate uses full body span (shoulder to ankle x-distance).
    const dx = Math.abs(ankle.x - shoulder.x);

    // Gate 3 (armsOverhead slot): arms extended forward/overhead
    // In side-facing prone pose: wrist extends further from body than shoulder
    // wrist.x < shoulder.x - ARMS_FORWARD_OFFSET (wrist is further left = further from body)
    const wristVisible = lmVisible(wrist);
    const armsForward = wristVisible && wrist.x < shoulder.x - ARMS_FORWARD_OFFSET;

    // Gate 4: distance via horizontal body span with hysteresis (Fix F)
    let distanceOk = true;
    let distanceHint: 'too-close' | 'too-far' | null = this.lastDistanceHint;

    if (distanceHint === 'too-far') {
      // Currently in 'too-far' — must exceed EXIT threshold to clear
      if (dx >= MIN_BODY_LENGTH_X_EXIT) {
        distanceHint = null;
      }
    } else if (distanceHint === 'too-close') {
      // Currently in 'too-close' — must drop below EXIT threshold to clear
      if (dx <= MAX_BODY_LENGTH_X_EXIT) {
        distanceHint = null;
      }
    } else {
      // No active hint — check ENTER thresholds
      if (dx < MIN_BODY_LENGTH_X_ENTER) {
        distanceHint = 'too-far';
      } else if (dx > MAX_BODY_LENGTH_X_ENTER) {
        distanceHint = 'too-close';
      }
    }

    if (distanceHint !== null) {
      distanceOk = false;
    }

    const checks = {
      fullBodyVisible: true,
      feetWide: horizontal,       // remap: "wide" slot = body horizontal + hips down
      armsOverhead: armsForward,  // remap: "overhead" slot = arms extended forward
      distanceOk,
    };

    if (!checks.feetWide || !checks.armsOverhead || !checks.distanceOk) {
      return { checks, distanceHint, baselineCandidate: null };
    }

    // Compute shoulder mid Y from both shoulders for baseline
    const lsVis = lmVisible(ls) ? ls : shoulder;
    const rsVis = lmVisible(rs) ? rs : shoulder;
    const shoulderMidY = (lsVis.y + rsVis.y) / 2;

    const baseline: SupermanBaseline = {
      side,
      bodyLength: dx,
      hipY: hip.y,
      kneeY: knee.y,
      shoulderY: shoulder.y,
      ankleY: ankle.y,
      shoulderMidY,
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
  getBaseline(): SupermanBaseline | null { return this.confirmedBaseline; }
}

/**
 * The shared `CalibrationUpdate.baseline` field is typed as squat's baseline.
 * We adapt — only the fields the play-page actually reads are populated.
 * Mirrors the toSquatBaseline pattern from dead-bug/calibration.ts.
 */
function toSquatBaseline(b: SupermanBaseline): CalibrationBaseline {
  const shoulderMid = { x: b.shoulderY, y: b.shoulderY };
  const hipMid      = { x: b.hipY,      y: b.hipY };
  const torsoHeight = Math.abs(b.hipY - b.shoulderY);

  return {
    shoulderMid,
    hipMid,
    hipWidth: b.bodyLength,
    shoulderWidth: b.bodyLength,
    torsoHeight,
    ankleY: b.ankleY,
    feetWidth: 0,
    feetVsShoulderRatio: 0,
    leftKneeX: 0,
    rightKneeX: 0,
  };
}
