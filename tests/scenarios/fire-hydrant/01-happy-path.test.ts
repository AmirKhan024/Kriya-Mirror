/**
 * Fire Hydrant — happy-path tests.
 * Verifies: calibration confirms, 4 clean lifts count as reps, mqs > 50, no warnings.
 */
import { describe, it, expect } from 'vitest';
import type { PoseLandmarks } from '@/modules/pose/types';
import type { CalibrationUpdate } from '@/modules/squat/types';
import { FireHydrantEngine } from '@/modules/fire-hydrant/engine';
import type { FireHydrantRepEvent, FireHydrantFrameMetrics } from '@/modules/fire-hydrant/types';
import type { WarningType } from '@/store/workout';
import type { Frame } from '../../harness/types';
import { buildFrames } from '../../harness/frame-stream';

// ---------------------------------------------------------------------------
// Local pose builder — side camera, user facing right, thighLiftDeg 0=rest
// ---------------------------------------------------------------------------
function buildFHPoseLocal(intent: {
  thighLiftDeg: number;
  bodySpan?: number;
  visibility?: number;
}): PoseLandmarks {
  const span = intent.bodySpan ?? 0.60;
  const liftDeg = Math.max(0, intent.thighLiftDeg);
  const vis = intent.visibility ?? 0.95;

  const SHOULDER_X = 0.68;
  const SHOULDER_Y = 0.42;
  const HIP_X = 0.45;
  const HIP_Y = 0.42;
  const L_THIGH = 0.18;
  const L_SHIN = 0.18;

  const rotRad = liftDeg * Math.PI / 180;
  const kneeX = HIP_X - L_THIGH * Math.sin(rotRad);
  const kneeY = HIP_Y + L_THIGH * Math.cos(rotRad);
  const ankleX = kneeX - L_SHIN;
  const ankleY = kneeY + L_SHIN * 0.3;

  const wristY = SHOULDER_Y + 0.32;
  const wristX = SHOULDER_X + 0.12;

  const lm: PoseLandmarks = Array.from({ length: 33 }, () => ({
    x: 0.5, y: 0.5, z: 0, visibility: 0.1,
  })) as unknown as PoseLandmarks;

  lm[11] = { x: SHOULDER_X, y: SHOULDER_Y, z: 0, visibility: vis };
  lm[12] = { x: SHOULDER_X, y: SHOULDER_Y + 0.01, z: 0, visibility: vis * 0.7 };
  lm[23] = { x: HIP_X, y: HIP_Y, z: 0, visibility: vis };
  lm[24] = { x: HIP_X, y: HIP_Y + 0.01, z: 0, visibility: vis * 0.7 };
  lm[25] = { x: kneeX, y: kneeY, z: 0, visibility: vis };
  lm[26] = { x: HIP_X, y: HIP_Y + L_THIGH, z: 0, visibility: vis * 0.6 };
  lm[27] = { x: ankleX, y: ankleY, z: 0, visibility: vis };
  lm[28] = { x: HIP_X - L_SHIN, y: HIP_Y + L_THIGH + L_SHIN * 0.3, z: 0, visibility: vis * 0.6 };
  lm[15] = { x: wristX, y: wristY, z: 0, visibility: vis };
  lm[16] = { x: wristX - 0.35, y: wristY, z: 0, visibility: vis * 0.7 };

  const currentSpan = Math.abs(ankleX - SHOULDER_X);
  const scaleFactor = span / (currentSpan || 0.41);
  const cxLocal = (SHOULDER_X + ankleX) / 2;
  for (const idx of [11, 12, 23, 24, 25, 26, 27, 28, 15, 16]) {
    lm[idx] = { ...lm[idx], x: cxLocal + (lm[idx].x - cxLocal) * scaleFactor };
  }

  return lm;
}

// ---------------------------------------------------------------------------
// Local runner
// ---------------------------------------------------------------------------
interface RunResult {
  completedReps: FireHydrantRepEvent[];
  warnings: Array<{ type: WarningType; atMs: number }>;
  finalCalibration: CalibrationUpdate | null;
  calibrationConfirmedAtMs: number | null;
  frameMetricsSamples: FireHydrantFrameMetrics[];
}

function runFHLocal(frames: Frame[]): RunResult {
  const completedReps: FireHydrantRepEvent[] = [];
  const warnings: Array<{ type: WarningType; atMs: number }> = [];
  const frameMetricsSamples: FireHydrantFrameMetrics[] = [];
  let finalCalibration: CalibrationUpdate | null = null;
  let calibrationConfirmedAtMs: number | null = null;
  let currentTMs = 0;

  const engine = new FireHydrantEngine({
    onCalibrationUpdate: (u) => {
      finalCalibration = u;
      if (u.state === 'confirmed' && calibrationConfirmedAtMs === null) {
        calibrationConfirmedAtMs = currentTMs;
      }
    },
    onRepComplete: (r) => completedReps.push(r),
    onPostureWarning: (type) => warnings.push({ type, atMs: currentTMs }),
    onFrame: (m) => frameMetricsSamples.push(m),
  });

  for (const frame of frames) {
    currentTMs = frame.tMs;
    engine.update(frame.landmarks, frame.tMs);
  }
  engine.finish();

  return { completedReps, warnings, finalCalibration, calibrationConfirmedAtMs, frameMetricsSamples };
}

function countWarnings(result: RunResult, type: WarningType): number {
  return result.warnings.filter((w) => w.type === type).length;
}

function warningsOtherThan(result: RunResult, ...excludes: WarningType[]): Array<{ type: WarningType; atMs: number }> {
  return result.warnings.filter((w) => !excludes.includes(w.type));
}

// ---------------------------------------------------------------------------
// Rep cycle helper
// ---------------------------------------------------------------------------
function happyPathIntent(reps: number, thighLiftPeakDeg = 55) {
  const calMs = 2200;
  const repCycleMs = 3000;
  const totalMs = calMs + reps * repCycleMs;

  return {
    totalMs,
    intentAt: (tMs: number) => {
      if (tMs < calMs) return { thighLiftDeg: 0 };
      const tInRep = (tMs - calMs) % repCycleMs;
      let thighLiftDeg: number;
      if (tInRep < 800) {
        thighLiftDeg = (tInRep / 800) * thighLiftPeakDeg;
      } else if (tInRep < 1400) {
        thighLiftDeg = thighLiftPeakDeg;
      } else if (tInRep < 2200) {
        thighLiftDeg = thighLiftPeakDeg - ((tInRep - 1400) / 800) * thighLiftPeakDeg;
      } else {
        thighLiftDeg = 0;
      }
      return { thighLiftDeg: Math.max(0, thighLiftDeg) };
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('Fire Hydrant — happy path', () => {
  it('calibrates within 2300ms and counts 4 clean lifts', () => {
    const { totalMs, intentAt } = happyPathIntent(4);
    const frames = buildFrames(intentAt, buildFHPoseLocal, { fps: 30, durationMs: totalMs });
    const result = runFHLocal(frames);

    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThanOrEqual(2300);
    expect(result.completedReps.length).toBeGreaterThanOrEqual(4);
    expect(warningsOtherThan(result, 'not-moving').length).toBe(0);
  });

  it('counts 3 reps when given a 3-rep stream', () => {
    const { totalMs, intentAt } = happyPathIntent(3);
    const frames = buildFrames(intentAt, buildFHPoseLocal, { fps: 30, durationMs: totalMs });
    const result = runFHLocal(frames);
    expect(result.completedReps.length).toBeGreaterThanOrEqual(3);
  });

  it('calibration state is confirmed after calibration phase', () => {
    const { totalMs, intentAt } = happyPathIntent(3);
    const frames = buildFrames(intentAt, buildFHPoseLocal, { fps: 30, durationMs: totalMs });
    const result = runFHLocal(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
  });

  it('all reps score mqs >= 50', () => {
    const { totalMs, intentAt } = happyPathIntent(3);
    const frames = buildFrames(intentAt, buildFHPoseLocal, { fps: 30, durationMs: totalMs });
    const result = runFHLocal(frames);
    expect(result.completedReps.length).toBeGreaterThanOrEqual(3);
    result.completedReps.forEach((rep) => {
      expect(rep.mqs).toBeGreaterThanOrEqual(50);
    });
  });

  it('no incomplete-fire-hydrant warnings on clean full-lift reps', () => {
    const { totalMs, intentAt } = happyPathIntent(3, 55);
    const frames = buildFrames(intentAt, buildFHPoseLocal, { fps: 30, durationMs: totalMs });
    const result = runFHLocal(frames);
    expect(countWarnings(result, 'incomplete-fire-hydrant')).toBe(0);
  });

  it('peak thighLiftDeg is recorded in depthDeg field', () => {
    const { totalMs, intentAt } = happyPathIntent(2, 55);
    const frames = buildFrames(intentAt, buildFHPoseLocal, { fps: 30, durationMs: totalMs });
    const result = runFHLocal(frames);
    expect(result.completedReps.length).toBeGreaterThanOrEqual(2);
    result.completedReps.forEach((rep) => {
      expect(rep.depthDeg).toBeGreaterThanOrEqual(35);
    });
  });
});
