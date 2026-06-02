import type { PoseLandmarks } from '@/modules/pose/types';
import { LM, lmVisible, midpoint } from './geometry';
import type { CalibrationBaseline, CalibrationState, CalibrationUpdate, MostBlockingGate } from './types';
import { debugLog } from '@/lib/debug';

// 2026-05-25 round 5: drop confirmation hold from 2000 → 200ms so calibration
// passes "instantly" once all gates green. Kept at 200ms (not 0) to debounce
// single-frame MediaPipe noise (~6 frames at 30fps, same as warning debounce).
const CONFIRM_DURATION_MS = 200;
const BAD_POSTURE_BUFFER_MS = 300;
// 2026-05-25: physical-test feedback — Amir requested 30s timeout (was 20s).
// Gives more grace before the retry button appears.
const TIMEOUT_MS = 30000;
const FEET_WIDTH_RATIO = 1.05;

// 2026-05-25: idle-during-calibration detection. If landmarks visible but
// the user isn't moving (shoulder/hip drift < 0.02 normalized units over 5s),
// the play page should prompt them.
const IDLE_THRESHOLD_MS = 5000;
const IDLE_MOVEMENT_TOLERANCE = 0.02;

/** Body-height fraction-of-frame target ranges. Outside = too-far / too-close. */
const BODY_HEIGHT_MIN = 0.45;   // user too far if body spans < 45% of frame height
const BODY_HEIGHT_MAX = 0.92;   // user too close if body fills > 92%

const REQUIRED_LM = [
  LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER,
  LM.LEFT_HIP, LM.RIGHT_HIP,
  LM.LEFT_KNEE, LM.RIGHT_KNEE,
  LM.LEFT_ANKLE, LM.RIGHT_ANKLE,
];

export class SquatCalibration {
  private startedAt: number;
  private goodPostureStart = 0;
  private badPostureStart = 0;
  private confirmedBaseline: CalibrationBaseline | null = null;
  private state: CalibrationState = 'waiting';
  private lastChecks: CalibrationUpdate['checks'] = {
    fullBodyVisible: false, feetWide: false, armsOverhead: false, distanceOk: false,
  };
  private lastDistanceHint: 'too-close' | 'too-far' | null = null;
  private lastMostBlockingGate: MostBlockingGate = null;
  // 2026-05-25: idle-during-cal tracking. Sample shoulder/hip midpoint;
  // if movement < tolerance for > IDLE_THRESHOLD_MS, surface idleHintMs.
  private idleAnchorSince = 0;
  private idleAnchorShoulderX = 0;
  private idleAnchorShoulderY = 0;
  private lastIdleHintMs = 0;

  constructor() {
    this.startedAt = performance.now();
  }

  /** Process one pose frame and return current calibration status. */
  update(landmarks: PoseLandmarks | null, now: number): CalibrationUpdate {
    if (this.state === 'confirmed') {
      return {
        state: this.state,
        progressMs: CONFIRM_DURATION_MS,
        checks: this.lastChecks,
        distanceHint: null,
        mostBlockingGate: null,
        idleHintMs: 0,
        baseline: this.confirmedBaseline ?? undefined,
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
      this.lastMostBlockingGate = 'no-body';
      this.idleAnchorSince = 0;
      return this.makeUpdate();
    }

    const { checks, distanceHint } = this.checkGates(landmarks);
    this.lastChecks = checks;
    this.lastDistanceHint = distanceHint;
    this.lastMostBlockingGate = pickMostBlockingGate(checks, distanceHint);
    const allPass = checks.fullBodyVisible && checks.feetWide && checks.armsOverhead && checks.distanceOk;

    // Idle-during-calibration check: track shoulder midpoint drift
    this.updateIdleAnchor(landmarks, now);

    const prevState = this.state;
    if (allPass) {
      this.badPostureStart = 0;
      if (this.goodPostureStart === 0) this.goodPostureStart = now;
      const heldMs = now - this.goodPostureStart;
      if (heldMs >= CONFIRM_DURATION_MS) {
        this.confirmedBaseline = this.captureBaseline(landmarks);
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
      debugLog('SQUAT', 'CALIB', `${prevState} → ${this.state}`, {
        gates: {
          fullBody: checks.fullBodyVisible,
          feetWide: checks.feetWide,
          arms: checks.armsOverhead,
          dist: checks.distanceOk,
        },
        distHint: distanceHint,
        blocking: this.lastMostBlockingGate,
      });
    }

    return this.makeUpdate();
  }

  private updateIdleAnchor(landmarks: PoseLandmarks, now: number): void {
    const ls = landmarks[LM.LEFT_SHOULDER];
    const rs = landmarks[LM.RIGHT_SHOULDER];
    if (!lmVisible(ls) || !lmVisible(rs)) {
      this.idleAnchorSince = 0;
      return;
    }
    const cx = (ls.x + rs.x) / 2;
    const cy = (ls.y + rs.y) / 2;
    if (this.idleAnchorSince === 0) {
      this.idleAnchorSince = now;
      this.idleAnchorShoulderX = cx;
      this.idleAnchorShoulderY = cy;
      return;
    }
    const dx = cx - this.idleAnchorShoulderX;
    const dy = cy - this.idleAnchorShoulderY;
    const moved = Math.hypot(dx, dy);
    if (moved > IDLE_MOVEMENT_TOLERANCE) {
      this.idleAnchorSince = now;
      this.idleAnchorShoulderX = cx;
      this.idleAnchorShoulderY = cy;
    }
  }

  private checkGates(landmarks: PoseLandmarks): {
    checks: CalibrationUpdate['checks'];
    distanceHint: 'too-close' | 'too-far' | null;
  } {
    const fullBodyVisible = REQUIRED_LM.every((i) => lmVisible(landmarks[i]));
    if (!fullBodyVisible) {
      return {
        checks: { fullBodyVisible: false, feetWide: false, armsOverhead: false, distanceOk: false },
        distanceHint: null,
      };
    }

    const ls = landmarks[LM.LEFT_SHOULDER];
    const rs = landmarks[LM.RIGHT_SHOULDER];
    const la = landmarks[LM.LEFT_ANKLE];
    const ra = landmarks[LM.RIGHT_ANKLE];
    const lw = landmarks[LM.LEFT_WRIST];
    const rw = landmarks[LM.RIGHT_WRIST];

    const shoulderWidth = Math.abs(ls.x - rs.x);
    const feetWidth = Math.abs(la.x - ra.x);
    const feetWide = shoulderWidth > 0 && feetWidth / shoulderWidth >= FEET_WIDTH_RATIO;

    const wristsVisible = lmVisible(lw) && lmVisible(rw);
    const armsOverhead = wristsVisible && lw.y < ls.y && rw.y < rs.y;

    // Distance check: body span (shoulder Y → ankle Y) as fraction of frame height.
    const shoulderY = (ls.y + rs.y) / 2;
    const ankleY = (la.y + ra.y) / 2;
    const bodyHeight = Math.abs(ankleY - shoulderY);

    let distanceOk = true;
    let distanceHint: 'too-close' | 'too-far' | null = null;
    if (bodyHeight < BODY_HEIGHT_MIN) {
      distanceOk = false;
      distanceHint = 'too-far';
    } else if (bodyHeight > BODY_HEIGHT_MAX) {
      distanceOk = false;
      distanceHint = 'too-close';
    }

    return {
      checks: { fullBodyVisible, feetWide, armsOverhead, distanceOk },
      distanceHint,
    };
  }

  private captureBaseline(landmarks: PoseLandmarks): CalibrationBaseline {
    const ls = landmarks[LM.LEFT_SHOULDER];
    const rs = landmarks[LM.RIGHT_SHOULDER];
    const lh = landmarks[LM.LEFT_HIP];
    const rh = landmarks[LM.RIGHT_HIP];
    const la = landmarks[LM.LEFT_ANKLE];
    const ra = landmarks[LM.RIGHT_ANKLE];
    const lk = landmarks[LM.LEFT_KNEE];
    const rk = landmarks[LM.RIGHT_KNEE];

    const shoulderMid = midpoint(ls, rs);
    const hipMid = midpoint(lh, rh);
    const hipWidth = Math.abs(lh.x - rh.x);
    const shoulderWidth = Math.abs(ls.x - rs.x);
    const feetWidth = Math.abs(la.x - ra.x);

    return {
      shoulderMid,
      hipMid,
      hipWidth,
      shoulderWidth,
      torsoHeight: Math.abs(hipMid.y - shoulderMid.y),
      ankleY: (la.y + ra.y) / 2,
      feetWidth,
      feetVsShoulderRatio: shoulderWidth > 0 ? feetWidth / shoulderWidth : 0,
      leftKneeX: lk.x,
      rightKneeX: rk.x,
    };
  }

  private resetProgress() {
    this.goodPostureStart = 0;
    this.badPostureStart = 0;
  }

  private makeUpdate(): CalibrationUpdate {
    const now = performance.now();
    const idleMs = this.idleAnchorSince > 0 ? now - this.idleAnchorSince : 0;
    // Only surface idleHintMs when the user has been idle past the threshold AND
    // calibration hasn't passed. Throttle: don't re-surface within 5s of last hint.
    let idleHintMs = 0;
    if (
      idleMs >= IDLE_THRESHOLD_MS
      && this.state !== 'confirmed'
      && now - this.lastIdleHintMs >= 5000
    ) {
      idleHintMs = idleMs;
      this.lastIdleHintMs = now;
    }

    return {
      state: this.state,
      progressMs: this.goodPostureStart > 0
        ? Math.min(CONFIRM_DURATION_MS, now - this.goodPostureStart)
        : 0,
      checks: this.lastChecks,
      distanceHint: this.lastDistanceHint,
      mostBlockingGate: this.lastMostBlockingGate,
      idleHintMs,
      baseline: this.confirmedBaseline ?? undefined,
    };
  }

  isConfirmed(): boolean { return this.state === 'confirmed'; }
  getBaseline(): CalibrationBaseline | null { return this.confirmedBaseline; }
}

/**
 * Choose the single most actionable failing gate. Priority:
 *   1. fullBody     — without the body in frame nothing else matters
 *   2. distance     — too far / too close → other gates will misread
 *   3. feetWide     — physical stance fix
 *   4. armsOverhead — last fix the user can address
 * Used to drive the prominent banner + voice prompt during calibration.
 */
function pickMostBlockingGate(
  checks: CalibrationUpdate['checks'],
  distanceHint: 'too-close' | 'too-far' | null,
): MostBlockingGate {
  if (!checks.fullBodyVisible) return 'no-body';
  if (!checks.distanceOk) return distanceHint === 'too-close' ? 'too-close' : 'too-far';
  if (!checks.feetWide) return 'feet-narrow';
  if (!checks.armsOverhead) return 'arms-not-overhead';
  return null;
}
