/**
 * MountainClimberCalibration — side camera, horizontal body (plank position).
 *
 * Mirrors PushupCalibration exactly. User starts in a high plank (hands under
 * shoulders, body straight). The camera sees the full body horizontally.
 *
 * Field meanings (reuse CalibrationUpdate shape):
 *   fullBodyVisible → shoulder+elbow+wrist+hip+ankle+knee visible on chosen side
 *   feetWide        → body horizontal (correct plank orientation; |dx|/|dy| ≥ 3.0)
 *   armsOverhead    → arms extended (elbow flex < 18° — plank arms straight)
 *   distanceOk      → body length in frame within acceptable range
 */
import type { PoseLandmarks } from '@/modules/pose/types';
import type { CalibrationUpdate } from '@/modules/squat/types';
import { LM, lmVisible } from './geometry';
import { elbowFlexionDeg } from '@/modules/pushup/geometry';
import type { MountainClimberBaseline } from './types';
import { debugLog } from '@/lib/debug';

// Fix G: CONFIRM_DURATION_MS = 200 (single ~6-frame debounce, "instant" confirm)
const CONFIRM_DURATION_MS = 200;
const BAD_POSTURE_BUFFER_MS = 300;
// Fix J: TIMEOUT_MS = 30_000
const TIMEOUT_MS = 30_000;

// Horizontal body check — mirrors pushup calibration exactly
// BUG-MC-04 FIX: 3.0 → 2.5. Camera height and slight plank incline push |dy|
// up enough that ratio=3.0 requires near-perfect horizontal (< 2.3° tilt).
const MIN_HORIZONTAL_RATIO = 2.5; // |dx| / |dy| ≥ 2.5 → roughly horizontal
const MIN_BODY_LENGTH_X = 0.45;
const MAX_BODY_LENGTH_X = 0.95;
// BUG-MC-03 FIX: 18 → 30. Vertical arms in side view cause perspective
// foreshortening that adds ~15–20° of apparent elbow flex even when locked out.
const ARMS_EXTENDED_FLEX_MAX = 30; // elbow flex < 30° (plank arms straight)

export class MountainClimberCalibration {
  private startedAt = 0;
  private goodPostureStart = 0;
  private badPostureStart = 0;
  private confirmedBaseline: MountainClimberBaseline | null = null;
  private state: 'waiting' | 'good' | 'confirmed' | 'timeout' = 'waiting';
  private lastChecks: CalibrationUpdate['checks'] = {
    fullBodyVisible: false, feetWide: false, armsOverhead: false, distanceOk: false,
  };
  private lastDistanceHint: 'too-close' | 'too-far' | null = null;

  update(landmarks: PoseLandmarks | null, now: number): CalibrationUpdate {
    if (this.state === 'confirmed') {
      return this.makeUpdate();
    }
    // BUG-MC-01 FIX: seed startedAt on first call; it is never assigned otherwise,
    // so it stays 0 and (performance.now() - 0) > 30000 fires immediately.
    if (this.startedAt === 0) this.startedAt = now;
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
      debugLog('MTNCLIMB', 'CALIB', `${prevState} → ${this.state}`, {
        gates: {
          fullBodyVisible: checks.fullBodyVisible,
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
    baselineCandidate: MountainClimberBaseline | null;
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
    const lk = landmarks[LM.LEFT_KNEE];
    const rk = landmarks[LM.RIGHT_KNEE];

    // Side detection — same as pushup: pick side with higher cumulative visibility
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
    const knee = side === 'left' ? lk : rk;

    const fullBodyVisible = lmVisible(shoulder) && lmVisible(hip) && lmVisible(ankle)
      && lmVisible(elbow) && lmVisible(wrist) && lmVisible(knee);

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

    // Fix H: distanceHint emitted on every CalibrationUpdate
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
      feetWide: horizontal,          // remapped: "body horizontal"
      armsOverhead: armsExtended,    // remapped: "arms straight / plank position"
      distanceOk,
    };

    if (!checks.feetWide || !checks.armsOverhead || !checks.distanceOk) {
      return { checks, distanceHint, baselineCandidate: null };
    }

    const plankMidpointY = shoulder.y + (ankle.y - shoulder.y) * 0.5;
    const baseline: MountainClimberBaseline = {
      shoulderY: shoulder.y,
      hipY: hip.y,
      kneeY: knee.y,
      ankleY: ankle.y,
      wristY: wrist.y,
      bodyLengthX: dx,
      plankMidpointY,
      side,
    };
    return { checks, distanceHint, baselineCandidate: baseline };
  }

  private resetProgress(): void {
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
  getBaseline(): MountainClimberBaseline | null { return this.confirmedBaseline; }
}
