/**
 * Step-Up — happy path.
 * Calibrates front-on (instant confirm ~200ms), then performs clean reps.
 *
 * Rep cycle (4000ms — step-ups are slow):
 *   0–1000ms:   rise from 0 → 0.15 (ASCENDING, hips go UP = hipY decreases)
 *   1000–2000ms: hold at 0.15 (AT_TOP)
 *   2000–3500ms: descend 0.15 → 0 (DESCENDING)
 *   3500–4000ms: rest at 0 (STANDING)
 *
 * hipRise = baseline.hipY - currentHipY = 0.15 at top.
 */
import { describe, it, expect } from 'vitest';
import { StepUpEngine } from '@/modules/step-up/engine';
import type { StepUpRepEvent } from '@/modules/step-up/types';
import type { CalibrationUpdate } from '@/modules/squat/types';
import type { WarningType } from '@/store/workout';
import type { PoseLandmarks, NormalizedLandmark } from '@/modules/pose/types';

// --- inline landmark helpers ---
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

/**
 * Build a step-up pose frame.
 * hipRise: 0 = standing at floor level, 0.15 = hips above baseline (on step).
 * Positive hipRise means hipY decreases (Y=0 is top of frame).
 */
function buildStepUpPose(hipRise: number, opts: {
  feetWidthRatio?: number;
  valgusRatio?: number;
  trunkLeanDeg?: number;
  bodyHeight?: number;
  visibility?: number;
  occludedIndices?: number[];
} = {}): PoseLandmarks {
  const {
    feetWidthRatio = 1.0,
    valgusRatio = 0,
    bodyHeight = 0.70,
    visibility = 0.95,
    occludedIndices,
  } = opts;

  const pose = emptyPose();
  const vis = visibility;
  const cx = 0.50;
  const shoulderW = 0.10;
  const baseAnkleY = 0.92;
  const shoulderY = baseAnkleY - bodyHeight;  // ≈ 0.22

  // Baseline standing hip (no rise): hipBaseY = shoulderY + 0.38 (roughly 55% down body)
  const hipBaseY = shoulderY + bodyHeight * 0.55;
  // When hipRise > 0, hip goes UP (y decreases)
  const hipY = hipBaseY - hipRise;
  const shoulderYNow = shoulderY - hipRise; // whole upper body shifts up

  // ankleXL/ankleXR: feetWidthRatio=1.0 → feet as wide as shoulders (feetWidth = shoulderWidth)
  const ankleXL = cx - shoulderW * feetWidthRatio;
  const ankleXR = cx + shoulderW * feetWidthRatio;

  // Knee X for valgus check: move lead knee toward midline
  const baselineKneeOffsetX = shoulderW * feetWidthRatio;
  const lkX = ankleXL + baselineKneeOffsetX * valgusRatio;  // left knee caves right (toward cx)
  const rkX = ankleXR - baselineKneeOffsetX * valgusRatio;  // right knee caves left (toward cx)
  // Hip X same as ankle (no sway)
  const hipXL = ankleXL;
  const hipXR = ankleXR;
  const kneeY = hipY + (baseAnkleY - hipY) * 0.5;

  pose[IDX.leftShoulder] = makeLM(cx - shoulderW, shoulderYNow, vis);
  pose[IDX.rightShoulder] = makeLM(cx + shoulderW, shoulderYNow, vis);
  pose[IDX.leftElbow] = makeLM(cx - shoulderW - 0.05, shoulderYNow + 0.08, vis);
  pose[IDX.rightElbow] = makeLM(cx + shoulderW + 0.05, shoulderYNow + 0.08, vis);
  // Wrists below shoulders (arms at sides)
  pose[IDX.leftWrist] = makeLM(cx - shoulderW - 0.05, shoulderYNow + 0.20, vis);
  pose[IDX.rightWrist] = makeLM(cx + shoulderW + 0.05, shoulderYNow + 0.20, vis);

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

  if (occludedIndices) {
    for (const i of occludedIndices) {
      if (pose[i]) pose[i].visibility = 0;
    }
  }

  return pose;
}

interface RepRecord {
  index: number;
  depthDeg: number;
  smoothness: number;
  form: number;
  mqs: number;
  warnings: WarningType[];
  atMs: number;
}
interface WarningRecord { type: WarningType; atMs: number; }
interface StepUpRunResult {
  completedReps: RepRecord[];
  warnings: WarningRecord[];
  finalCalibration: CalibrationUpdate | null;
  calibrationConfirmedAtMs: number | null;
}

function runStepUpSession(frames: Array<{ landmarks: PoseLandmarks | null; tMs: number }>): StepUpRunResult {
  const completedReps: RepRecord[] = [];
  const warnings: WarningRecord[] = [];
  let finalCalibration: CalibrationUpdate | null = null;
  let calibrationConfirmedAtMs: number | null = null;
  let currentTMs = 0;

  const engine = new StepUpEngine({
    onCalibrationUpdate: (u) => {
      finalCalibration = u;
      if (u.state === 'confirmed' && calibrationConfirmedAtMs === null) {
        calibrationConfirmedAtMs = currentTMs;
      }
    },
    onRepComplete: (rep: StepUpRepEvent) => {
      completedReps.push({
        index: completedReps.length + 1,
        depthDeg: rep.depthDeg,
        smoothness: rep.smoothness,
        form: rep.form,
        mqs: rep.mqs,
        warnings: rep.warnings,
        atMs: currentTMs,
      });
    },
    onPostureWarning: (type) => {
      warnings.push({ type, atMs: currentTMs });
    },
  });

  for (const frame of frames) {
    currentTMs = frame.tMs;
    engine.update(frame.landmarks, frame.tMs);
  }
  engine.finish();

  return { completedReps, warnings, finalCalibration, calibrationConfirmedAtMs };
}

function buildFrames(
  intentAt: (tMs: number) => number | null,
  fps = 30,
  durationMs = 5000,
): Array<{ landmarks: PoseLandmarks | null; tMs: number }> {
  const dt = 1000 / fps;
  const frames: Array<{ landmarks: PoseLandmarks | null; tMs: number }> = [];
  for (let t = 0; t < durationMs; t += dt) {
    const rise = intentAt(t);
    frames.push({
      landmarks: rise === null ? null : buildStepUpPose(rise),
      tMs: t,
    });
  }
  return frames;
}

function happyPath(reps: number) {
  const calMs = 2200;
  const repCycleMs = 4000;
  const totalMs = calMs + reps * repCycleMs;

  return buildFrames((tMs) => {
    if (tMs < calMs) return 0;  // standing still for calibration
    const tInRep = (tMs - calMs) % repCycleMs;
    if (tInRep < 1000) {
      // Rise from 0 → 0.15
      return (tInRep / 1000) * 0.15;
    }
    if (tInRep < 2000) {
      // Hold at top
      return 0.15;
    }
    if (tInRep < 3500) {
      // Descend 0.15 → 0
      return 0.15 * (1 - (tInRep - 2000) / 1500);
    }
    return 0;  // rest at standing
  }, 30, totalMs);
}

describe('Step-Up — happy path', () => {
  it('calibrates within 2500ms', () => {
    const frames = happyPath(1);
    const result = runStepUpSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).not.toBeNull();
    expect(result.calibrationConfirmedAtMs!).toBeLessThanOrEqual(2500);
  });

  it('counts 4 clean reps', () => {
    const frames = happyPath(4);
    const result = runStepUpSession(frames);
    expect(result.completedReps.length).toBe(4);
  });

  it('counts 3 clean reps', () => {
    const frames = happyPath(3);
    const result = runStepUpSession(frames);
    expect(result.completedReps.length).toBe(3);
  });

  it('produces zero form warnings on clean reps', () => {
    const frames = happyPath(3);
    const result = runStepUpSession(frames);
    const nonIdleWarnings = result.warnings.filter((w) => w.type !== 'not-moving');
    expect(nonIdleWarnings.length).toBe(0);
  });

  it('MQS is between 0 and 100 for each rep', () => {
    const frames = happyPath(3);
    const result = runStepUpSession(frames);
    for (const rep of result.completedReps) {
      expect(rep.mqs).toBeGreaterThanOrEqual(0);
      expect(rep.mqs).toBeLessThanOrEqual(100);
    }
  });

  it('MQS average is at least 60 for clean reps', () => {
    const frames = happyPath(4);
    const result = runStepUpSession(frames);
    expect(result.completedReps.length).toBeGreaterThan(0);
    const avgMqs = result.completedReps.reduce((s, r) => s + r.mqs, 0) / result.completedReps.length;
    expect(avgMqs).toBeGreaterThanOrEqual(60);
  });

  it('hip rise (depthDeg) reflects the step height', () => {
    const frames = happyPath(2);
    const result = runStepUpSession(frames);
    for (const rep of result.completedReps) {
      expect(rep.depthDeg).toBeGreaterThan(0.09);
    }
  });
});
