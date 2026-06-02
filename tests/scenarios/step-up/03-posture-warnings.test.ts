/**
 * Step-Up — posture warnings.
 *
 * Tests:
 *   - valgus fires when valgusRatio=0.25 during ASCENDING (> VALGUS_THRESHOLD_RATIO=0.20, >= 10 frames)
 *   - trunk-forward fires when trunkLeanDeg=45 during ASCENDING (> TRUNK_WARN_DEG=40, >= 6 frames)
 *   - neither fires when repState=STANDING (Fix A gate)
 *   - valgus debounce: 9 frames of valgus (<10) does NOT fire
 *   - valgus debounce: 11 frames of valgus (>10) DOES fire
 */
import { describe, it, expect } from 'vitest';
import { StepUpEngine } from '@/modules/step-up/engine';
import type { StepUpRepEvent } from '@/modules/step-up/types';
import type { CalibrationUpdate } from '@/modules/squat/types';
import type { WarningType } from '@/store/workout';
import type { PoseLandmarks, NormalizedLandmark } from '@/modules/pose/types';

const IDX = {
  leftShoulder: 11, rightShoulder: 12,
  leftElbow: 13, rightElbow: 14,
  leftWrist: 15, rightWrist: 16,
  leftHip: 23, rightHip: 24,
  leftKnee: 25, rightKnee: 26,
  leftAnkle: 27, rightAnkle: 28,
  leftHeel: 29, rightHeel: 30,
  leftFootIndex: 31, rightFootIndex: 32,
  nose: 0, leftEye: 2, rightEye: 5, leftEar: 7, rightEar: 8,
};
const LM_COUNT = 33;

function makeLM(x: number, y: number, visibility = 0.95): NormalizedLandmark {
  return { x, y, z: 0, visibility };
}
function emptyPose(): PoseLandmarks {
  const out = new Array(LM_COUNT) as PoseLandmarks;
  for (let i = 0; i < LM_COUNT; i++) out[i] = makeLM(0.5, 0.5, 0);
  return out;
}

function buildStepUpPose(hipRise: number, opts: {
  valgusRatio?: number;
  trunkLeanDeg?: number;
  vis?: number;
} = {}): PoseLandmarks {
  const { valgusRatio = 0, trunkLeanDeg = 0, vis = 0.95 } = opts;
  const pose = emptyPose();
  const cx = 0.50;
  const shoulderW = 0.10;
  const baseAnkleY = 0.92;
  const bodyHeight = 0.70;
  const shoulderY = baseAnkleY - bodyHeight;
  const hipBaseY = shoulderY + bodyHeight * 0.55;
  const hipY = hipBaseY - hipRise;

  // Trunk lean: shift shoulder midpoint forward relative to hip
  // To produce trunkLeanDeg from atan2(|dx|, dy), we need dx = tan(angle) * dy
  const trunkLeanRad = (trunkLeanDeg * Math.PI) / 180;
  const torsoHeight = hipBaseY - shoulderY;  // dy component in trunkLeanDeg calculation
  const trunkShiftX = Math.tan(trunkLeanRad) * torsoHeight;
  const shoulderYNow = shoulderY - hipRise;

  // ankleXL/ankleXR: feetWidthRatio=1.0 → feet as wide as shoulders
  const ankleXL = cx - shoulderW;
  const ankleXR = cx + shoulderW;
  const hipXL = ankleXL;
  const hipXR = ankleXR;

  // Baseline knee X offsets
  const baselineKneeOffset = shoulderW;
  // Valgus: shrink knee toward midline proportionally
  const kneeCollapseLeft = baselineKneeOffset * valgusRatio;
  const kneeCollapseRight = baselineKneeOffset * valgusRatio;
  const lkX = hipXL + kneeCollapseLeft;   // left knee moves right (collapse)
  const rkX = hipXR - kneeCollapseRight;  // right knee moves left (collapse)
  const kneeY = hipY + (baseAnkleY - hipY) * 0.5;

  pose[IDX.leftShoulder] = makeLM(cx - shoulderW + trunkShiftX, shoulderYNow, vis);
  pose[IDX.rightShoulder] = makeLM(cx + shoulderW + trunkShiftX, shoulderYNow, vis);
  pose[IDX.leftElbow] = makeLM(cx - shoulderW + trunkShiftX - 0.05, shoulderYNow + 0.08, vis);
  pose[IDX.rightElbow] = makeLM(cx + shoulderW + trunkShiftX + 0.05, shoulderYNow + 0.08, vis);
  pose[IDX.leftWrist] = makeLM(cx - shoulderW + trunkShiftX - 0.05, shoulderYNow + 0.20, vis);
  pose[IDX.rightWrist] = makeLM(cx + shoulderW + trunkShiftX + 0.05, shoulderYNow + 0.20, vis);
  pose[IDX.leftHip] = makeLM(hipXL, hipY, vis);
  pose[IDX.rightHip] = makeLM(hipXR, hipY, vis);
  pose[IDX.leftKnee] = makeLM(lkX, kneeY, vis);
  pose[IDX.rightKnee] = makeLM(rkX, kneeY, vis);
  pose[IDX.leftAnkle] = makeLM(ankleXL, baseAnkleY, vis);
  pose[IDX.rightAnkle] = makeLM(ankleXR, baseAnkleY, vis);
  pose[IDX.leftHeel] = makeLM(ankleXL, baseAnkleY + 0.02, vis);
  pose[IDX.rightHeel] = makeLM(ankleXR, baseAnkleY + 0.02, vis);
  pose[IDX.leftFootIndex] = makeLM(ankleXL + 0.02, baseAnkleY + 0.03, vis);
  pose[IDX.rightFootIndex] = makeLM(ankleXR - 0.02, baseAnkleY + 0.03, vis);

  const noseY = shoulderYNow - 0.07;
  pose[IDX.nose] = makeLM(cx, noseY, vis);
  pose[IDX.leftEye] = makeLM(cx - 0.02, noseY - 0.01, vis);
  pose[IDX.rightEye] = makeLM(cx + 0.02, noseY - 0.01, vis);
  pose[IDX.leftEar] = makeLM(cx - 0.04, noseY, vis);
  pose[IDX.rightEar] = makeLM(cx + 0.04, noseY, vis);

  return pose;
}

interface WarningRecord { type: WarningType; atMs: number; }
interface RunResult { warnings: WarningRecord[]; calibrated: boolean; }

function runWithWarningMonitor(opts: {
  /** hipRise as function of tMs */
  hipRiseAt: (tMs: number) => number;
  /** Pose options per frame */
  poseOptsAt?: (tMs: number) => { valgusRatio?: number; trunkLeanDeg?: number };
  calMs?: number;
  durationMs?: number;
  fps?: number;
}): RunResult {
  const { hipRiseAt, poseOptsAt, calMs = 2200, durationMs = 8000, fps = 30 } = opts;
  const dt = 1000 / fps;
  const warnings: WarningRecord[] = [];
  let calibrated = false;
  let currentTMs = 0;

  const engine = new StepUpEngine({
    onCalibrationUpdate: (u) => {
      if (u.state === 'confirmed') calibrated = true;
    },
    onRepComplete: (_rep: StepUpRepEvent) => { /* noop */ },
    onPostureWarning: (type) => {
      warnings.push({ type, atMs: currentTMs });
    },
  });

  void calMs;

  for (let t = 0; t < durationMs; t += dt) {
    currentTMs = t;
    const rise = hipRiseAt(t);
    const poseOpts = poseOptsAt ? poseOptsAt(t) : {};
    engine.update(buildStepUpPose(rise, poseOpts), t);
  }
  engine.finish();

  return { warnings, calibrated };
}

describe('Step-Up — posture warnings', () => {
  it('valgus fires when valgusRatio=0.50 sustained during ASCENDING', () => {
    // kneeDeviation = 0.5 * valgusRatio = 0.25 > VALGUS_THRESHOLD_RATIO=0.20
    const CAL_MS = 2200;
    const result = runWithWarningMonitor({
      hipRiseAt: (tMs) => {
        if (tMs < CAL_MS) return 0;
        const t = tMs - CAL_MS;
        if (t < 1500) return (t / 1500) * 0.15;  // rising
        if (t < 2500) return 0.15;
        if (t < 4000) return 0.15 * (1 - (t - 2500) / 1500);
        return 0;
      },
      poseOptsAt: (tMs) => {
        if (tMs < CAL_MS) return {};
        const t = tMs - CAL_MS;
        if (t < 1500) return { valgusRatio: 0.50 };  // valgus during ascending
        return {};
      },
      durationMs: CAL_MS + 5000,
    });

    expect(result.calibrated).toBe(true);
    const valgusWarnings = result.warnings.filter((w) => w.type === 'valgus');
    expect(valgusWarnings.length).toBeGreaterThan(0);
  });

  it('trunk-forward fires when trunkLeanDeg=45 sustained during ASCENDING', () => {
    const CAL_MS = 2200;
    const result = runWithWarningMonitor({
      hipRiseAt: (tMs) => {
        if (tMs < CAL_MS) return 0;
        const t = tMs - CAL_MS;
        if (t < 1500) return (t / 1500) * 0.15;
        if (t < 2500) return 0.15;
        if (t < 4000) return 0.15 * (1 - (t - 2500) / 1500);
        return 0;
      },
      poseOptsAt: (tMs) => {
        if (tMs < CAL_MS) return {};
        const t = tMs - CAL_MS;
        if (t < 1500) return { trunkLeanDeg: 45 };  // trunk lean during ascending
        return {};
      },
      durationMs: CAL_MS + 5000,
    });

    expect(result.calibrated).toBe(true);
    const trunkWarnings = result.warnings.filter((w) => w.type === 'trunk-forward');
    expect(trunkWarnings.length).toBeGreaterThan(0);
  });

  it('valgus does NOT fire when repState=STANDING (Fix A gate)', () => {
    // Feed valgus frames ONLY during standing (hipRise=0, never enters ASCENDING)
    const result = runWithWarningMonitor({
      hipRiseAt: () => 0,  // always standing, never steps
      poseOptsAt: () => ({ valgusRatio: 0.60 }),  // strong valgus but only during standing
      durationMs: 4000,
    });

    expect(result.calibrated).toBe(true);
    const valgusWarnings = result.warnings.filter((w) => w.type === 'valgus');
    expect(valgusWarnings.length).toBe(0);
  });

  it('trunk-forward does NOT fire when repState=STANDING (Fix A gate)', () => {
    const result = runWithWarningMonitor({
      hipRiseAt: () => 0,
      poseOptsAt: () => ({ trunkLeanDeg: 50 }),
      durationMs: 4000,
    });

    expect(result.calibrated).toBe(true);
    const trunkWarnings = result.warnings.filter((w) => w.type === 'trunk-forward');
    expect(trunkWarnings.length).toBe(0);
  });

  it('valgus debounce: brief valgus (< 10 frames while ASCENDING) does NOT fire', () => {
    // Step up with valgus ONLY for 8 frames while in ASCENDING — below the 10-frame debounce.
    // The valgus window starts AFTER the engine enters ASCENDING (hipRise crosses threshold).
    // We model this by: valgus=0 during calibration, then valgus=0.50 for 8 frames after
    // hipRise exceeds STEP_ENTER_THRESHOLD=0.04.
    const CAL_MS = 2200;
    const FPS = 30;
    const DT = 1000 / FPS;
    // Time for hip to reach STEP_ENTER_THRESHOLD=0.04 at rate 0.15/1000ms
    const ASCENDING_START_APPROX_MS = (0.04 / 0.15) * 1000 + 200; // ~467ms after cal
    const VALGUS_START_MS = CAL_MS + ASCENDING_START_APPROX_MS;
    const VALGUS_END_MS = VALGUS_START_MS + 8 * DT;

    const warnings: WarningRecord[] = [];
    let calibrated = false;
    let currentTMs = 0;

    const engine = new StepUpEngine({
      onCalibrationUpdate: (u) => { if (u.state === 'confirmed') calibrated = true; },
      onRepComplete: (_rep: StepUpRepEvent) => { /* noop */ },
      onPostureWarning: (type) => { warnings.push({ type, atMs: currentTMs }); },
    });

    const totalMs = CAL_MS + 4000;
    for (let t = 0; t < totalMs; t += DT) {
      currentTMs = t;
      const tAfterCal = t - CAL_MS;
      let hipRise = 0;
      if (tAfterCal > 0 && tAfterCal < 2500) {
        hipRise = Math.min(0.15, (tAfterCal / 1000) * 0.15);
      }
      // Valgus only for 8 frames in the early ASCENDING phase
      const valgusRatio = (t >= VALGUS_START_MS && t < VALGUS_END_MS) ? 0.50 : 0;
      const pose = buildStepUpPose(hipRise, { valgusRatio });
      engine.update(pose, t);
    }
    engine.finish();

    expect(calibrated).toBe(true);
    const valgusWarnings = warnings.filter((w) => w.type === 'valgus');
    expect(valgusWarnings.length).toBe(0);
  });

  it('valgus debounce: sustained valgus (>= 10 frames while ASCENDING) DOES fire', () => {
    // Step up with valgus for entire ascending phase (>10 frames) — exceeds debounce.
    const CAL_MS = 2200;
    const FPS = 30;
    const DT = 1000 / FPS;

    const warnings: WarningRecord[] = [];
    let calibrated = false;
    let currentTMs = 0;

    const engine = new StepUpEngine({
      onCalibrationUpdate: (u) => { if (u.state === 'confirmed') calibrated = true; },
      onRepComplete: (_rep: StepUpRepEvent) => { /* noop */ },
      onPostureWarning: (type) => { warnings.push({ type, atMs: currentTMs }); },
    });

    // Step up over 1500ms ascending — that's 45 frames, well above debounce=10
    const totalMs = CAL_MS + 4000;
    for (let t = 0; t < totalMs; t += DT) {
      currentTMs = t;
      const tAfterCal = t - CAL_MS;
      let hipRise = 0;
      if (tAfterCal > 0 && tAfterCal < 2500) {
        hipRise = Math.min(0.15, (tAfterCal / 1000) * 0.15);
      }
      // Valgus throughout the entire step (both ascending and AT_TOP)
      const valgusRatio = (tAfterCal > 0 && tAfterCal < 2000) ? 0.50 : 0;
      const pose = buildStepUpPose(hipRise, { valgusRatio });
      engine.update(pose, t);
    }
    engine.finish();

    expect(calibrated).toBe(true);
    const valgusWarnings = warnings.filter((w) => w.type === 'valgus');
    expect(valgusWarnings.length).toBeGreaterThan(0);
  });
});
