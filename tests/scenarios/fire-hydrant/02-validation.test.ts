/**
 * Fire Hydrant — rep validation tests.
 * Verifies: shallow reps rejected, ballistic reps rejected, valid reps accepted.
 */
import { describe, it, expect } from 'vitest';
import type { PoseLandmarks } from '@/modules/pose/types';
import type { CalibrationUpdate } from '@/modules/squat/types';
import { FireHydrantEngine } from '@/modules/fire-hydrant/engine';
import type { FireHydrantRepEvent } from '@/modules/fire-hydrant/types';
import type { WarningType } from '@/store/workout';
import type { Frame } from '../../harness/types';

function buildFHPose(thighLiftDeg: number, vis = 0.95): PoseLandmarks {
  const liftDeg = Math.max(0, thighLiftDeg);
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
  lm[15] = { x: SHOULDER_X + 0.12, y: SHOULDER_Y + 0.32, z: 0, visibility: vis };
  lm[16] = { x: SHOULDER_X - 0.23, y: SHOULDER_Y + 0.32, z: 0, visibility: vis * 0.7 };
  return lm;
}

function runEngine(frames: Frame[]): {
  completedReps: FireHydrantRepEvent[];
  warnings: Array<{ type: WarningType; atMs: number }>;
  calibrationConfirmedAtMs: number | null;
} {
  const completedReps: FireHydrantRepEvent[] = [];
  const warnings: Array<{ type: WarningType; atMs: number }> = [];
  let calibrationConfirmedAtMs: number | null = null;
  let currentTMs = 0;

  const engine = new FireHydrantEngine({
    onCalibrationUpdate: (u: CalibrationUpdate) => {
      if (u.state === 'confirmed' && calibrationConfirmedAtMs === null) {
        calibrationConfirmedAtMs = currentTMs;
      }
    },
    onRepComplete: (r) => completedReps.push(r),
    onPostureWarning: (type) => warnings.push({ type, atMs: currentTMs }),
  });

  for (const frame of frames) {
    currentTMs = frame.tMs;
    engine.update(frame.landmarks, frame.tMs);
  }
  engine.finish();
  return { completedReps, warnings, calibrationConfirmedAtMs };
}

function buildFrameStream(intentFn: (tMs: number) => number, totalMs: number, fps = 30): Frame[] {
  const frames: Frame[] = [];
  const step = 1000 / fps;
  for (let t = 0; t <= totalMs; t += step) {
    frames.push({ landmarks: buildFHPose(intentFn(t)), tMs: t });
  }
  return frames;
}

describe('Fire Hydrant — rep validation', () => {
  it('rejects a shallow rep (peak < 35°) with incomplete-fire-hydrant warning', () => {
    // Cal phase + one shallow rep (peak ~20°)
    const CAL_MS = 2200;
    const frames = buildFrameStream((t) => {
      if (t < CAL_MS) return 0;
      const tRep = t - CAL_MS;
      if (tRep < 800) return (tRep / 800) * 20;
      if (tRep < 1400) return 20;
      if (tRep < 2200) return 20 - ((tRep - 1400) / 800) * 20;
      return 0;
    }, CAL_MS + 3000);

    const result = runEngine(frames);
    expect(result.completedReps.length).toBe(0);
    expect(result.warnings.some((w) => w.type === 'incomplete-fire-hydrant')).toBe(true);
  });

  it('rejects a ballistic rep (too fast < 500ms) with malformed-rep warning', () => {
    const CAL_MS = 2200;
    // Build frames with a ballistic rep: full cycle in 300ms
    const frames: Frame[] = [];
    const fps = 30;
    const step = 1000 / fps;
    const totalMs = CAL_MS + 2000;
    for (let t = 0; t <= totalMs; t += step) {
      let liftDeg = 0;
      if (t >= CAL_MS) {
        const tRep = t - CAL_MS;
        if (tRep < 100) liftDeg = (tRep / 100) * 55;
        else if (tRep < 200) liftDeg = 55;
        else if (tRep < 300) liftDeg = 55 - ((tRep - 200) / 100) * 55;
        else liftDeg = 0;
      }
      frames.push({ landmarks: buildFHPose(liftDeg), tMs: t });
    }
    const result = runEngine(frames);
    expect(result.completedReps.length).toBe(0);
    expect(result.warnings.some((w) => w.type === 'malformed-rep')).toBe(true);
  });

  it('accepts a valid rep with peak >= 35° and duration >= 500ms', () => {
    const CAL_MS = 2200;
    const frames = buildFrameStream((t) => {
      if (t < CAL_MS) return 0;
      const tRep = t - CAL_MS;
      if (tRep < 800) return (tRep / 800) * 50;
      if (tRep < 1400) return 50;
      if (tRep < 2200) return 50 - ((tRep - 1400) / 800) * 50;
      return 0;
    }, CAL_MS + 3000);

    const result = runEngine(frames);
    expect(result.completedReps.length).toBeGreaterThanOrEqual(1);
    expect(result.completedReps[0].depthDeg).toBeGreaterThanOrEqual(35);
  });
});
