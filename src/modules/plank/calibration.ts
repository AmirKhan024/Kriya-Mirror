import type { PoseLandmarks } from '@/modules/pose/types';
import type { CalibrationUpdate } from '@/modules/squat/types';
import { LM, lmVisible } from '@/modules/squat/geometry';
import type { PlankBaseline } from './types';
import { debugLog } from '@/lib/debug';

// 2026-05-25 round 5: drop confirmation hold from 2000 → 200ms so calibration
// passes "instantly" once all gates are green (per user feedback). Kept at
// 200ms (not 0) to debounce single-frame MediaPipe noise — at 30fps this is
// ~6 frames, same window as the warning debounce.
const CONFIRM_DURATION_MS = 200;
const BAD_POSTURE_BUFFER_MS = 300;
const TIMEOUT_MS = 20000;

// Body should be roughly horizontal: shoulder-to-ankle x-span vs y-span ratio.
// Higher = flatter. Plank-acceptable when horizontal span dominates.
const MIN_HORIZONTAL_RATIO = 3.0; // |dx| / |dy| ≥ 3.0 → roughly horizontal
// Minimum body length in normalized x-coordinates (proxy for distance).
// 2026-05-25 round 4: hysteresis band — entering "distance OK" requires the
// stricter enter window; staying in it requires only the wider exit window.
// Without this, small frame-to-frame jitter at the threshold flipped the gate
// 9+ times in one session (logs t=60660–85536), forcing 25s of calibration.
const MIN_BODY_LENGTH_X_ENTER = 0.45;
const MAX_BODY_LENGTH_X_ENTER = 0.95;
const MIN_BODY_LENGTH_X_EXIT = 0.40;   // ~11% wider on the "too-far" side
const MAX_BODY_LENGTH_X_EXIT = 1.00;   // ~5% wider on the "too-close" side

export class PlankCalibration {
  private startedAt: number;
  private goodPostureStart = 0;
  private badPostureStart = 0;
  private confirmedBaseline: PlankBaseline | null = null;
  private state: 'waiting' | 'good' | 'confirmed' | 'timeout' = 'waiting';
  private lastChecks: CalibrationUpdate['checks'] = {
    fullBodyVisible: false, feetWide: false, armsOverhead: false, distanceOk: false,
  };
  private lastDistanceHint: 'too-close' | 'too-far' | null = null;
  // 2026-05-25 round 4: persisted across frames so we can apply the wider
  // "exit" thresholds once the gate is satisfied.
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
      debugLog('PLANK', 'CALIB', `${prevState} → ${this.state}`, {
        gates: {
          sideProfile: checks.fullBodyVisible,
          horizontal: checks.feetWide,
          forearm: checks.armsOverhead,
          dist: checks.distanceOk,
        },
        distHint: distanceHint,
      });
    }

    return this.makeUpdate();
  }

  /**
   * Reuses the same `checks` shape as squat calibration so the play-page overlay
   * code is shared. Field meanings are remapped:
   *   fullBodyVisible → shoulder+hip+ankle all visible (side profile)
   *   feetWide        → body roughly horizontal (correct plank orientation)
   *   armsOverhead    → forearm or hand contact zone (elbow ≈ shoulder x for low plank)
   *   distanceOk      → body length in frame is within the acceptable range
   */
  private checkGates(landmarks: PoseLandmarks): {
    checks: CalibrationUpdate['checks'];
    distanceHint: 'too-close' | 'too-far' | null;
    baselineCandidate: PlankBaseline | null;
  } {
    // Pick the side with better visibility
    const ls = landmarks[LM.LEFT_SHOULDER];
    const rs = landmarks[LM.RIGHT_SHOULDER];
    const lh = landmarks[LM.LEFT_HIP];
    const rh = landmarks[LM.RIGHT_HIP];
    const la = landmarks[LM.LEFT_ANKLE];
    const ra = landmarks[LM.RIGHT_ANKLE];
    const le = landmarks[LM.LEFT_ELBOW];
    const re = landmarks[LM.RIGHT_ELBOW];
    const nose = landmarks[LM.NOSE];

    const leftScore = (ls?.visibility ?? 0) + (lh?.visibility ?? 0) + (la?.visibility ?? 0);
    const rightScore = (rs?.visibility ?? 0) + (rh?.visibility ?? 0) + (ra?.visibility ?? 0);
    const side: 'left' | 'right' = leftScore >= rightScore ? 'left' : 'right';

    const shoulder = side === 'left' ? ls : rs;
    const hip = side === 'left' ? lh : rh;
    const ankle = side === 'left' ? la : ra;
    const elbow = side === 'left' ? le : re;

    const fullBodyVisible = lmVisible(shoulder) && lmVisible(hip) && lmVisible(ankle) && lmVisible(elbow);
    if (!fullBodyVisible) {
      return {
        checks: { fullBodyVisible: false, feetWide: false, armsOverhead: false, distanceOk: false },
        distanceHint: null,
        baselineCandidate: null,
      };
    }

    // Body horizontal? span x dominates span y
    const dx = Math.abs(ankle.x - shoulder.x);
    const dy = Math.abs(ankle.y - shoulder.y);
    const horizontalRatio = dy > 0.001 ? dx / dy : 999;
    const horizontal = horizontalRatio >= MIN_HORIZONTAL_RATIO;

    // Forearm/hand contact zone: elbow x roughly under shoulder x (low plank)
    // OR wrist roughly under elbow (high plank). Either is acceptable.
    const elbowUnderShoulderX = Math.abs(elbow.x - shoulder.x) < 0.10;
    const forearmContact = elbowUnderShoulderX;

    // Distance via body length in x — with hysteresis so small frame jitter
    // doesn't repeatedly flip the gate near the threshold.
    const min = this.distInBand ? MIN_BODY_LENGTH_X_EXIT : MIN_BODY_LENGTH_X_ENTER;
    const max = this.distInBand ? MAX_BODY_LENGTH_X_EXIT : MAX_BODY_LENGTH_X_ENTER;
    let distanceOk = true;
    let distanceHint: 'too-close' | 'too-far' | null = null;
    if (dx < min) {
      distanceOk = false;
      distanceHint = 'too-far';
    } else if (dx > max) {
      distanceOk = false;
      distanceHint = 'too-close';
    }
    this.distInBand = distanceOk;

    const checks = {
      fullBodyVisible: true,
      feetWide: horizontal,           // remap meaning
      armsOverhead: forearmContact,   // remap meaning
      distanceOk,
    };

    if (!checks.feetWide || !checks.armsOverhead || !checks.distanceOk) {
      return { checks, distanceHint, baselineCandidate: null };
    }

    const baseline: PlankBaseline = {
      shoulderY: shoulder.y,
      hipY: hip.y,
      ankleY: ankle.y,
      side,
      bodyLength: dx,
      noseY: nose?.y ?? shoulder.y,
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
      // We don't return a baseline via the shared CalibrationUpdate (its shape
      // assumes squat's baseline). Engine reads our baseline via getBaseline().
    };
  }

  isConfirmed(): boolean { return this.state === 'confirmed'; }
  getBaseline(): PlankBaseline | null { return this.confirmedBaseline; }
}
