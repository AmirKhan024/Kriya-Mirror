/**
 * Cat-Cow calibration — SIDE profile, on all fours, spine NEUTRAL. Mirrors the
 * seated-forward-fold side-on pattern (pick the camera-facing side by landmark
 * visibility; distance via a horizontal body span, not shoulderWidth — side-on,
 * the two shoulders stack in depth so |L−R shoulder x| collapses). The shared
 * plank-shaped `checks` slots are remapped:
 *   fullBodyVisible → camera-side nose + shoulder + hip + knee + wrist visible
 *   feetWide        → on all fours, back roughly LEVEL (shoulder→hip horizontal)
 *   armsOverhead    → head/spine NEUTRAL (|neck pitch| small, not already arched)
 *   distanceOk      → body span |wristX − kneeX| (hysteresis + too-far floor)
 */
import type { PoseLandmarks } from '@/modules/pose/types';
import type { CalibrationUpdate } from '@/modules/squat/types';
import { LM, lmVisible, neckPitchDeg } from './geometry';
import type { CatCowBaseline } from './types';
import { debugLog } from '@/lib/debug';

const CONFIRM_DURATION_MS = 200;
const BAD_POSTURE_BUFFER_MS = 300;
const TIMEOUT_MS = 20000;

// On all fours, the torso (shoulder→hip) is roughly horizontal: |dx|/|dy| ≥ this.
const BACK_LEVEL_RATIO = 2.0;
// Head neutral: neck pitch within this band of level (not already cow/cat).
const NEUTRAL_HEAD_BAND_DEG = 18;

// Distance via the side-on front-to-back span |wristX − kneeX|, with hysteresis.
// The MIN edge doubles as the Fix-X analog (too-small span = too far / poorly
// detected → reject as 'too-far'; the runtime metric is a pure angle).
const BODY_SPAN_MIN_ENTER = 0.20;
const BODY_SPAN_MAX_ENTER = 0.95;
const BODY_SPAN_MIN_EXIT = 0.16;
const BODY_SPAN_MAX_EXIT = 1.00;

export class CatCowCalibration {
  private startedAt: number;
  private goodPostureStart = 0;
  private badPostureStart = 0;
  private confirmedBaseline: CatCowBaseline | null = null;
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
      debugLog('CATCOW', 'CALIB', `${prevState} → ${this.state}`, {
        gates: {
          sideProfile: checks.fullBodyVisible,
          backLevel: checks.feetWide,
          headNeutral: checks.armsOverhead,
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
    baselineCandidate: CatCowBaseline | null;
  } {
    const nose = landmarks[LM.NOSE];
    const ls = landmarks[LM.LEFT_SHOULDER];
    const rs = landmarks[LM.RIGHT_SHOULDER];
    const lh = landmarks[LM.LEFT_HIP];
    const rh = landmarks[LM.RIGHT_HIP];
    const lk = landmarks[LM.LEFT_KNEE];
    const rk = landmarks[LM.RIGHT_KNEE];
    const lw = landmarks[LM.LEFT_WRIST];
    const rw = landmarks[LM.RIGHT_WRIST];

    // Camera-facing side = higher summed visibility of shoulder+hip+knee+wrist.
    const leftScore = (ls?.visibility ?? 0) + (lh?.visibility ?? 0) + (lk?.visibility ?? 0) + (lw?.visibility ?? 0);
    const rightScore = (rs?.visibility ?? 0) + (rh?.visibility ?? 0) + (rk?.visibility ?? 0) + (rw?.visibility ?? 0);
    const side: 'left' | 'right' = leftScore >= rightScore ? 'left' : 'right';

    const shoulder = side === 'left' ? ls : rs;
    const hip = side === 'left' ? lh : rh;
    const knee = side === 'left' ? lk : rk;
    const wrist = side === 'left' ? lw : rw;

    const fullBodyVisible = lmVisible(nose) && lmVisible(shoulder) && lmVisible(hip)
      && lmVisible(knee) && lmVisible(wrist);
    if (!fullBodyVisible) {
      return {
        checks: { fullBodyVisible: false, feetWide: false, armsOverhead: false, distanceOk: false },
        distanceHint: null,
        baselineCandidate: null,
      };
    }

    // On all fours, back level: torso (shoulder→hip) roughly horizontal.
    const torsoDx = Math.abs(shoulder.x - hip.x);
    const torsoDy = Math.abs(shoulder.y - hip.y);
    const backLevel = torsoDx / Math.max(torsoDy, 1e-6) >= BACK_LEVEL_RATIO;

    // Head/spine neutral (not already arched/rounded).
    const pitch = neckPitchDeg(nose, shoulder);
    const headNeutral = Math.abs(pitch) < NEUTRAL_HEAD_BAND_DEG;

    // Distance via the side-on body span (front hand → back knee).
    const bodyLengthX = Math.abs(wrist.x - knee.x);
    const min = this.distInBand ? BODY_SPAN_MIN_EXIT : BODY_SPAN_MIN_ENTER;
    const max = this.distInBand ? BODY_SPAN_MAX_EXIT : BODY_SPAN_MAX_ENTER;
    let distanceOk = true;
    let distanceHint: 'too-close' | 'too-far' | null = null;
    if (bodyLengthX < min) {
      distanceOk = false;
      distanceHint = 'too-far';
    } else if (bodyLengthX > max) {
      distanceOk = false;
      distanceHint = 'too-close';
    }
    this.distInBand = distanceOk;

    const checks = {
      fullBodyVisible: true,
      feetWide: backLevel,       // remap: "wide" slot → "on all fours, back level"
      armsOverhead: headNeutral, // remap: "overhead" slot → "head/spine neutral"
      distanceOk,
    };

    if (!checks.feetWide || !checks.armsOverhead || !checks.distanceOk) {
      return { checks, distanceHint, baselineCandidate: null };
    }

    const baseline: CatCowBaseline = {
      side,
      neutralPitchDeg: pitch,
      hipX: hip.x,
      bodyLengthX,
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
      // Baseline read internally via getBaseline() (like cobra / seated-fold) —
      // the shared CalibrationUpdate.baseline shape assumes front-facing fields.
    };
  }

  isConfirmed(): boolean { return this.state === 'confirmed'; }
  getBaseline(): CatCowBaseline | null { return this.confirmedBaseline; }
}
