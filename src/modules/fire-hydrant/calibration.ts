/**
 * Fire Hydrant calibration — side camera, mirrors donkey-kick's pattern.
 * The person kneels on all fours (quadruped position).
 *
 * Reuses the squat CalibrationUpdate shape so the play-page overlay component
 * is shared. Field meanings are remapped:
 *   fullBodyVisible → shoulder+hip+knee+ankle all visible on dominant side
 *   feetWide        → body horizontal (|dx|/|dy| >= 2.5)
 *   armsOverhead    → hands below shoulders (wrist.y > shoulder.y + 0.05)
 *   distanceOk      → horizontal body span between 0.40 and 0.75
 */
import type { PoseLandmarks } from '@/modules/pose/types';
import type { CalibrationUpdate, CalibrationBaseline } from '@/modules/squat/types';
import { LM, lmVisible } from '@/modules/squat/geometry';
import type { FireHydrantBaseline } from './types';
import { debugLog } from '@/lib/debug';

// Fix G: instant confirm ~6-frame debounce against MediaPipe single-frame noise.
const CONFIRM_DURATION_MS = 200;
const BAD_POSTURE_BUFFER_MS = 300;
const TIMEOUT_MS = 20000;

const MIN_HORIZONTAL_RATIO = 2.5; // |dx| / |dy| >= 2.5 → roughly horizontal (quadruped)
const HANDS_DOWN_OFFSET = 0.05;   // wrist.y must be > shoulder.y + 0.05 (hands below shoulder)

// Fix F: distance hint hysteresis
const BODY_LENGTH_MIN_ENTER = 0.40; // below this = 'too-far'
const BODY_LENGTH_MIN_EXIT  = 0.43; // must exceed this to clear 'too-far'
const BODY_LENGTH_MAX_ENTER = 0.75; // above this = 'too-close'
const BODY_LENGTH_MAX_EXIT  = 0.72; // must drop below this to clear 'too-close'

export class FireHydrantCalibration {
  private startedAt: number;
  private goodPostureStart = 0;
  private badPostureStart = 0;
  private confirmedBaseline: FireHydrantBaseline | null = null;
  private state: 'waiting' | 'good' | 'confirmed' | 'timeout' = 'waiting';
  private lastChecks: CalibrationUpdate['checks'] = {
    fullBodyVisible: false, feetWide: false, armsOverhead: false, distanceOk: false,
  };
  private lastDistanceHint: 'too-close' | 'too-far' | null = null;
  private seededAt = false;
  private lastNow = 0;

  constructor() {
    this.startedAt = 0; // seeded from first update() call
  }

  update(landmarks: PoseLandmarks | null, now: number): CalibrationUpdate {
    if (!this.seededAt) {
      this.startedAt = now;
      this.seededAt = true;
    }
    this.lastNow = now;

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
      debugLog('FH', 'CALIB', `${prevState} → ${this.state}`, {
        gates: {
          sideProfile: checks.fullBodyVisible,
          horizontal: checks.feetWide,
          handsDown: checks.armsOverhead,
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
    baselineCandidate: FireHydrantBaseline | null;
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

    // Gate 2 (feetWide slot): body horizontal in quadruped position.
    const torsoX = Math.abs(hip.x - shoulder.x);
    const torsoY = Math.abs(hip.y - shoulder.y);
    const horizontalRatio = torsoY > 0.001 ? torsoX / torsoY : 999;
    const bodyHorizontal = horizontalRatio >= MIN_HORIZONTAL_RATIO;

    // Distance gate uses full horizontal body span (shoulder to ankle x-distance).
    const dx = Math.abs(ankle.x - shoulder.x);

    // Gate 3 (armsOverhead slot): hands below shoulders (wrist.y > shoulder.y + 0.05)
    const wristVisible = lmVisible(wrist);
    const handsDown = wristVisible && wrist.y > shoulder.y + HANDS_DOWN_OFFSET;

    // Gate 4: distance via horizontal body span with hysteresis (Fix F)
    let distanceOk = true;
    let distanceHint: 'too-close' | 'too-far' | null = this.lastDistanceHint;

    if (distanceHint === 'too-far') {
      if (dx >= BODY_LENGTH_MIN_EXIT) {
        distanceHint = null;
      }
    } else if (distanceHint === 'too-close') {
      if (dx <= BODY_LENGTH_MAX_EXIT) {
        distanceHint = null;
      }
    } else {
      if (dx < BODY_LENGTH_MIN_ENTER) {
        distanceHint = 'too-far';
      } else if (dx > BODY_LENGTH_MAX_ENTER) {
        distanceHint = 'too-close';
      }
    }

    if (distanceHint !== null) {
      distanceOk = false;
    }

    const checks = {
      fullBodyVisible: true,
      feetWide: bodyHorizontal,   // remap: "wide" slot = body horizontal
      armsOverhead: handsDown,    // remap: "overhead" slot = hands hanging down
      distanceOk,
    };

    if (!checks.feetWide || !checks.armsOverhead || !checks.distanceOk) {
      return { checks, distanceHint, baselineCandidate: null };
    }

    const baseline: FireHydrantBaseline = {
      side,
      bodyLength: dx,
      hipY: hip.y,
      shoulderY: shoulder.y,
      ankleY: ankle.y,
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
        ? Math.min(CONFIRM_DURATION_MS, this.lastNow - this.goodPostureStart)
        : 0,
      checks: this.lastChecks,
      distanceHint: this.lastDistanceHint,
      baseline: this.confirmedBaseline ? toSquatBaseline(this.confirmedBaseline) : undefined,
    };
  }

  isConfirmed(): boolean { return this.state === 'confirmed'; }
  getBaseline(): FireHydrantBaseline | null { return this.confirmedBaseline; }
}

function toSquatBaseline(b: FireHydrantBaseline): CalibrationBaseline {
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
