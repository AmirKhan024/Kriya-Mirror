/**
 * Donkey Kick calibration — side camera, mirrors bird-dog's pattern.
 * The person kneels on all fours (quadruped position).
 *
 * Reuses the squat CalibrationUpdate shape so the play-page overlay component
 * is shared. Field meanings are remapped:
 *   fullBodyVisible → shoulder+hip+knee all visible on dominant side (ankle excluded — occluded in kneeling)
 *   feetWide        → body horizontal (|dx|/|dy| >= 1.5) — shoulder and hip at same height
 *   armsOverhead    → hands below shoulders, arms hanging down (wrist.y > shoulder.y + 0.05)
 *   distanceOk      → knee-to-shoulder horizontal span between 0.25 and 0.58
 */
import type { PoseLandmarks } from '@/modules/pose/types';
import type { CalibrationUpdate, CalibrationBaseline, MostBlockingGate } from '@/modules/squat/types';
import { LM, lmVisible } from '@/modules/squat/geometry';
import type { DonkeyKickBaseline } from './types';
import { debugLog } from '@/lib/debug';

// Fix G: instant confirm ~6-frame debounce against MediaPipe single-frame noise.
const CONFIRM_DURATION_MS = 200;
const BAD_POSTURE_BUFFER_MS = 300;
const TIMEOUT_MS = 20000;

// BUG-DK-CAL-04: was 2.5 — fails with elevated cameras (laptop/shelf). 1.5 rejects upright poses (ratio ~0.2)
// while accepting all real-world quadruped angles including 25° camera tilt.
const MIN_HORIZONTAL_RATIO = 1.5;
const HANDS_DOWN_OFFSET = 0.05;   // wrist.y must be > shoulder.y + 0.05 (hands below shoulder)

// BUG-DK-CAL-03: recalibrated for knee-to-shoulder horizontal span (was ankle-based, thresholds too high).
// Typical adult at 1.5m side-on kneeling: knee-to-shoulder ≈ 0.30–0.38. Very close (0.8m): ≈ 0.50–0.58.
const BODY_LENGTH_MIN_ENTER = 0.25; // below this = 'too-far'
const BODY_LENGTH_MIN_EXIT  = 0.27; // must exceed this to clear 'too-far'
const BODY_LENGTH_MAX_ENTER = 0.58; // above this = 'too-close'
const BODY_LENGTH_MAX_EXIT  = 0.56; // must drop below this to clear 'too-close'

export class DonkeyKickCalibration {
  private startedAt: number;
  private goodPostureStart = 0;
  private badPostureStart = 0;
  private confirmedBaseline: DonkeyKickBaseline | null = null;
  private state: 'waiting' | 'good' | 'confirmed' | 'timeout' = 'waiting';
  private lastChecks: CalibrationUpdate['checks'] = {
    fullBodyVisible: false, feetWide: false, armsOverhead: false, distanceOk: false,
  };
  private lastDistanceHint: 'too-close' | 'too-far' | null = null;
  private seededAt = false;
  private lastNow = 0;

  constructor() {
    this.startedAt = 0; // will be seeded from first update() call
  }

  update(landmarks: PoseLandmarks | null, now: number): CalibrationUpdate {
    // Seed startedAt from first real timestamp (supports test harness using tMs)
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
      debugLog('DONKEY', 'CALIB', `${prevState} → ${this.state}`, {
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
    baselineCandidate: DonkeyKickBaseline | null;
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

    // Gate 1: all key landmarks visible on the dominant side.
    // BUG-DK-CAL-01: ankle removed — it is occluded in kneeling and causes the gate to fail
    // on most hardware even when the user is correctly positioned. Knee is sufficient.
    const fullBodyVisible = lmVisible(shoulder) && lmVisible(hip) && lmVisible(knee);

    if (!fullBodyVisible) {
      return {
        checks: { fullBodyVisible: false, feetWide: false, armsOverhead: false, distanceOk: false },
        distanceHint: null,
        baselineCandidate: null,
      };
    }

    // Gate 2 (feetWide slot): body horizontal in quadruped position.
    // Check shoulder→hip vector: |dx|/|dy| >= 2.5 means body is mostly horizontal.
    const torsoX = Math.abs(hip.x - shoulder.x);
    const torsoY = Math.abs(hip.y - shoulder.y);
    const horizontalRatio = torsoY > 0.001 ? torsoX / torsoY : 999;
    const bodyHorizontal = horizontalRatio >= MIN_HORIZONTAL_RATIO;

    // BUG-DK-CAL-02: use knee (most stable landmark in kneeling) instead of ankle
    // (ankle.x is jittery when occluded — MediaPipe pulls it toward 0.5, causing flickering dx).
    const dx = Math.abs(knee.x - shoulder.x);

    // Gate 3 (armsOverhead slot): hands below shoulders (wrist.y > shoulder.y + 0.05)
    // In screen coords, y increases downward; wrist being "below" shoulder means wrist.y > shoulder.y.
    const wristVisible = lmVisible(wrist);
    const handsDown = wristVisible && wrist.y > shoulder.y + HANDS_DOWN_OFFSET;

    // Gate 4: distance via horizontal body span with hysteresis (Fix F)
    let distanceOk = true;
    let distanceHint: 'too-close' | 'too-far' | null = this.lastDistanceHint;

    if (distanceHint === 'too-far') {
      // Currently in 'too-far' — must exceed EXIT threshold to clear
      if (dx >= BODY_LENGTH_MIN_EXIT) {
        distanceHint = null;
      }
    } else if (distanceHint === 'too-close') {
      // Currently in 'too-close' — must drop below EXIT threshold to clear
      if (dx <= BODY_LENGTH_MAX_EXIT) {
        distanceHint = null;
      }
    } else {
      // No active hint — check ENTER thresholds
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

    const baseline: DonkeyKickBaseline = {
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

  // BUG-DK-CAL-05: drives voice coaching in play page via CALIB_GATE_SPEECH lookup
  private deriveMostBlockingGate(): MostBlockingGate {
    if (!this.lastChecks.fullBodyVisible) return 'no-body';
    if (!this.lastChecks.distanceOk) {
      return this.lastDistanceHint === 'too-close' ? 'too-close' : 'too-far';
    }
    if (!this.lastChecks.feetWide)     return 'feet-narrow';
    if (!this.lastChecks.armsOverhead) return 'arms-not-overhead';
    return null;
  }

  private makeUpdate(): CalibrationUpdate {
    return {
      state: this.state,
      progressMs: this.goodPostureStart > 0
        ? Math.min(CONFIRM_DURATION_MS, this.lastNow - this.goodPostureStart)
        : 0,
      checks: this.lastChecks,
      distanceHint: this.lastDistanceHint,
      mostBlockingGate: this.state === 'confirmed' ? null : this.deriveMostBlockingGate(),
      baseline: this.confirmedBaseline ? toSquatBaseline(this.confirmedBaseline) : undefined,
    };
  }

  isConfirmed(): boolean { return this.state === 'confirmed'; }
  getBaseline(): DonkeyKickBaseline | null { return this.confirmedBaseline; }
}

/**
 * The shared `CalibrationUpdate.baseline` field is typed as squat's baseline.
 * We adapt — only the fields the play-page actually reads are populated.
 * Mirrors the toSquatBaseline pattern from lunge/calibration.ts and dead-bug/calibration.ts.
 */
function toSquatBaseline(b: DonkeyKickBaseline): CalibrationBaseline {
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
