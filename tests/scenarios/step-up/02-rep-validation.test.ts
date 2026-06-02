/**
 * Step-Up — rep validation.
 *
 * Tests:
 *   Case 1: shallow step (peak hipRise = 0.07 < MIN_HIP_RISE=0.10, below AT_TOP_THRESHOLD=0.12)
 *           → hip returns to 0, EMA settles, fallback fires → 'incomplete-step-up' emitted, rep discarded
 *   Case 2: ballistic/noise spike (hip velocity > MAX_HIP_VELOCITY=3.0) → 'malformed-rep'
 *   Case 3: valid step after an incomplete → counts the valid rep, not the incomplete
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

function buildStepUpPose(hipRise: number, vis = 0.95): PoseLandmarks {
  const pose = emptyPose();
  const cx = 0.50;
  const shoulderW = 0.10;
  const baseAnkleY = 0.92;
  const bodyHeight = 0.70;
  const shoulderY = baseAnkleY - bodyHeight;
  const hipBaseY = shoulderY + bodyHeight * 0.55;
  const hipY = hipBaseY - hipRise;
  const shoulderYNow = shoulderY - hipRise;
  // feet as wide as shoulders (feetWidthRatio=1.0)
  const ankleXL = cx - shoulderW;
  const ankleXR = cx + shoulderW;
  const hipXL = ankleXL;
  const hipXR = ankleXR;
  const kneeY = hipY + (baseAnkleY - hipY) * 0.5;

  pose[IDX.leftShoulder] = makeLM(cx - shoulderW, shoulderYNow, vis);
  pose[IDX.rightShoulder] = makeLM(cx + shoulderW, shoulderYNow, vis);
  pose[IDX.leftElbow] = makeLM(cx - shoulderW - 0.05, shoulderYNow + 0.08, vis);
  pose[IDX.rightElbow] = makeLM(cx + shoulderW + 0.05, shoulderYNow + 0.08, vis);
  pose[IDX.leftWrist] = makeLM(cx - shoulderW - 0.05, shoulderYNow + 0.20, vis);
  pose[IDX.rightWrist] = makeLM(cx + shoulderW + 0.05, shoulderYNow + 0.20, vis);
  pose[IDX.leftHip] = makeLM(hipXL, hipY, vis);
  pose[IDX.rightHip] = makeLM(hipXR, hipY, vis);
  pose[IDX.leftKnee] = makeLM(hipXL - 0.01, kneeY, vis);
  pose[IDX.rightKnee] = makeLM(hipXR + 0.01, kneeY, vis);
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

interface RepRecord { index: number; depthDeg: number; mqs: number; warnings: WarningType[]; atMs: number; }
interface WarningRecord { type: WarningType; atMs: number; }
interface RunResult {
  completedReps: RepRecord[];
  warnings: WarningRecord[];
  finalCalibration: CalibrationUpdate | null;
  calibrationConfirmedAtMs: number | null;
}

function run(frames: Array<{ landmarks: PoseLandmarks | null; tMs: number }>): RunResult {
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

const FPS = 30;
const DT = 1000 / FPS;
const CAL_MS = 2200;

function makeFrames(hipRiseAt: (tMs: number) => number | null, durationMs: number) {
  const frames: Array<{ landmarks: PoseLandmarks | null; tMs: number }> = [];
  for (let t = 0; t < durationMs; t += DT) {
    const rise = hipRiseAt(t);
    frames.push({
      landmarks: rise === null ? null : buildStepUpPose(rise),
      tMs: t,
    });
  }
  return frames;
}

describe('Step-Up — rep validation', () => {
  it('Case 1: shallow step (peak hipRise=0.07 < AT_TOP_THRESHOLD and < MIN_HIP_RISE) → incomplete-step-up', () => {
    // Rep attempt: rise to 0.07 (< AT_TOP_THRESHOLD=0.12, < MIN_HIP_RISE=0.10)
    // Hip returns to 0, EMA settles, fallback fires and rejects with incomplete-step-up.
    const TOTAL_MS = CAL_MS + 5000;
    const frames = makeFrames((tMs) => {
      if (tMs < CAL_MS) return 0;
      const t = tMs - CAL_MS;
      if (t < 600) return (t / 600) * 0.07;      // rise to 0.07
      if (t < 1000) return 0.07;                  // hold at 0.07
      if (t < 1800) return 0.07 * (1 - (t - 1000) / 800); // descend
      return 0;                                   // rest at 0
    }, TOTAL_MS);

    const result = run(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    // Rep should be discarded (not counted)
    expect(result.completedReps.length).toBe(0);
    // incomplete-step-up should be warned
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const incompleteWarnings = result.warnings.filter((w) => (w.type as any) === 'incomplete-step-up');
    expect(incompleteWarnings.length).toBeGreaterThan(0);
  });

  it('Case 2: jitter spike during rep (velocity > MAX_HIP_VELOCITY=3.0) → malformed-rep', () => {
    // A rep that rises normally to AT_TOP, then has a single-frame jitter spike mid-hold
    // (hip jumps from 0.15 to 0.50 for one frame then back to 0.15).
    // Velocity of the spike = (0.50-0.15)/DT ≈ 10.5 > MAX_HIP_VELOCITY=3.0.
    // The rep then descends normally, but validateRepShape rejects it as 'ballistic' → 'malformed-rep'.
    const JITTER_MS = CAL_MS + 1500;  // 1500ms into rep cycle = during AT_TOP hold
    const TOTAL_MS = CAL_MS + 8000;
    const frames = makeFrames((tMs) => {
      if (tMs < CAL_MS) return 0;
      const t = tMs - CAL_MS;
      // Normal rise
      if (t < 1000) return (t / 1000) * 0.15;
      // Jitter spike at t=1500ms: one frame at 0.50 then back to 0.15
      if (tMs >= JITTER_MS && tMs < JITTER_MS + DT) return 0.50;
      // Normal hold and descent
      if (t < 2000) return 0.15;
      if (t < 3500) return 0.15 * (1 - (t - 2000) / 1500);
      return 0;
    }, TOTAL_MS);

    const result = run(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    // Rep should be rejected as ballistic (velocity spike > MAX_HIP_VELOCITY=3.0)
    expect(result.completedReps.length).toBe(0);
    const malformedWarnings = result.warnings.filter((w) => w.type === 'malformed-rep');
    expect(malformedWarnings.length).toBeGreaterThan(0);
  });

  it('Case 3: valid step after incomplete → counts only the valid rep', () => {
    // Shallow step first (discarded as incomplete), then a valid deep step
    const TOTAL_MS = CAL_MS + 12000;
    const frames = makeFrames((tMs) => {
      if (tMs < CAL_MS) return 0;
      const t = tMs - CAL_MS;
      // Shallow attempt at t=0..2000ms (discarded with incomplete-step-up)
      if (t < 600) return (t / 600) * 0.07;
      if (t < 1000) return 0.07;
      if (t < 1800) return 0.07 * (1 - (t - 1000) / 800);
      if (t < 3000) return 0;  // wait for fallback cooldown (1000ms) to expire

      // Valid rep at t=3000..7500ms
      const t2 = t - 3000;
      if (t2 < 1000) return (t2 / 1000) * 0.15;
      if (t2 < 2000) return 0.15;
      if (t2 < 3500) return 0.15 * (1 - (t2 - 2000) / 1500);
      return 0;
    }, TOTAL_MS);

    const result = run(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    // Only the valid rep should count
    expect(result.completedReps.length).toBe(1);
    expect(result.completedReps[0].depthDeg).toBeGreaterThan(0.09);
    // The incomplete-step-up warning should have fired for the shallow one
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const incompleteWarnings = result.warnings.filter((w) => (w.type as any) === 'incomplete-step-up');
    expect(incompleteWarnings.length).toBeGreaterThan(0);
  });
});
