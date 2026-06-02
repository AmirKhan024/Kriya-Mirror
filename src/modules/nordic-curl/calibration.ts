/**
 * Nordic Curl calibration — side camera, kneeling upright.
 *
 * Gates:
 *   fullBodyVisible → shoulder, hip, knee on the active side are visible
 *   feetWide        → body spans 45–92% of frame height (distance gate)
 *   armsOverhead    → trunkLean < 20° (user kneeling upright, not already leaning)
 *   distanceOk      → same distance gate
 *
 * Reuses the squat CalibrationUpdate shape so the play-page overlay is shared.
 */
import type { PoseLandmarks } from '@/modules/pose/types';
import type { CalibrationUpdate } from '@/modules/squat/types';
import type { CalibrationBaseline } from '@/modules/squat/types';
import {
  LM, lmVisible, trunkLeanDeg as computeTrunkLean, pickActiveSide, getSideLandmarks,
} from './geometry';
import type { NordicCurlBaseline } from './types';
import { debugLog } from '@/lib/debug';

const CONFIRM_DURATION_MS = 200;
const BAD_POSTURE_BUFFER_MS = 300;
const TIMEOUT_MS = 30000;

// Body height gates (vertical span of body in frame, fraction of frame height)
const BODY_HEIGHT_MIN = 0.45;  // Fix F: hysteresis lower bound
const BODY_HEIGHT_MAX = 0.92;  // Fix F: hysteresis upper bound

// Upright gate: trunkLean must be below this to be "kneeling tall"
const BODY_UPRIGHT_MAX_DEG = 20;

export class NordicCurlCalibration {
  private startedAt = -1; // seeded from first update() call (same pattern as barbell-row)
  private goodPostureStart = 0;
  private badPostureStart = 0;
  private confirmedBaseline: NordicCurlBaseline | null = null;
  private state: 'waiting' | 'good' | 'confirmed' | 'timeout' = 'waiting';
  private lastChecks: CalibrationUpdate['checks'] = {
    fullBodyVisible: false, feetWide: false, armsOverhead: false, distanceOk: false,
  };
  private lastDistanceHint: 'too-close' | 'too-far' | null = null;

  // Lock active side after first clean frame
  private lockedSide: 'left' | 'right' | null = null;

  update(landmarks: PoseLandmarks | null, now: number): CalibrationUpdate {
    // Seed startedAt from the first `now` (frame.tMs), not wall-clock performance.now().
    // This ensures timeout works correctly in tests where frame timestamps start at 0.
    if (this.startedAt < 0) this.startedAt = now;

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
      debugLog('NORDIC-CURL', 'CALIB', `${prevState} → ${this.state}`, {
        gates: {
          sideProfile: checks.fullBodyVisible,
          bodyHeight: checks.feetWide,
          upright: checks.armsOverhead,
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
    baselineCandidate: NordicCurlBaseline | null;
  } {
    // Pick or lock active side
    if (this.lockedSide === null) {
      this.lockedSide = pickActiveSide(landmarks);
    }
    const side = this.lockedSide;
    const { shoulder, hip, knee, ankle } = getSideLandmarks(landmarks, side);

    // Gate 1: fullBodyVisible — shoulder, hip, knee on the active side are visible
    const fullBodyVisible = lmVisible(shoulder) && lmVisible(hip) && lmVisible(knee);
    if (!fullBodyVisible) {
      return {
        checks: { fullBodyVisible: false, feetWide: false, armsOverhead: false, distanceOk: false },
        distanceHint: null,
        baselineCandidate: null,
      };
    }

    // Gate 2: bodyHeight — body spans 45–92% of frame height
    // Use nose-to-ankle as a proxy for the full visible body span
    // Fall back to shoulder-to-ankle if nose not visible
    const noseLm = landmarks[0]; // IDX.nose = 0
    const topY = (noseLm && lmVisible(noseLm)) ? noseLm.y : shoulder.y;
    const bottomY = (ankle && lmVisible(ankle)) ? ankle.y : knee.y;
    const bodyHeightFrac = Math.max(0, bottomY - topY);

    let distanceOk = true;
    let distanceHint: 'too-close' | 'too-far' | null = null;
    if (bodyHeightFrac > BODY_HEIGHT_MAX) {
      distanceOk = false;
      distanceHint = 'too-close';
    } else if (bodyHeightFrac < BODY_HEIGHT_MIN) {
      distanceOk = false;
      distanceHint = 'too-far';
    }

    // Gate 3: bodyUpright — trunkLean < 20° (user kneeling tall, not already leaning)
    const lean = computeTrunkLean(shoulder, hip);
    const bodyUpright = lean < BODY_UPRIGHT_MAX_DEG;

    const checks = {
      fullBodyVisible: true,
      feetWide: distanceOk,      // remap: distance gate → feetWide slot
      armsOverhead: bodyUpright,  // remap: upright gate → armsOverhead slot
      distanceOk,
    };

    if (!checks.feetWide || !checks.armsOverhead || !checks.distanceOk) {
      return { checks, distanceHint, baselineCandidate: null };
    }

    const torsoHeight = Math.abs(shoulder.y - hip.y);
    const baseline: NordicCurlBaseline = {
      activeSide: side,
      hipX: hip.x,
      hipY: hip.y,
      shoulderX: shoulder.x,
      shoulderY: shoulder.y,
      torsoHeight: torsoHeight > 0 ? torsoHeight : 0.10,
      kneeY: knee.y,
      ankleY: (ankle && lmVisible(ankle)) ? ankle.y : knee.y + 0.10,
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
  getBaseline(): NordicCurlBaseline | null { return this.confirmedBaseline; }
}

/** Adapter: map NordicCurlBaseline → squat's CalibrationBaseline shape. */
export function toSquatBaseline(b: NordicCurlBaseline): CalibrationBaseline {
  return {
    shoulderMid: { x: b.shoulderX, y: b.shoulderY },
    hipMid: { x: b.hipX, y: b.hipY },
    hipWidth: 0,
    shoulderWidth: 0,
    torsoHeight: b.torsoHeight,
    ankleY: b.ankleY,
    feetWidth: 0,
    feetVsShoulderRatio: 0,
    leftKneeX: b.hipX,
    rightKneeX: b.hipX,
  };
}
