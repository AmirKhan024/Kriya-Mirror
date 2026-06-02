/**
 * Fire Hydrant — Fix N: position-lost detection.
 *
 * After calibration confirms, if no usable pose landmarks arrive for ≥ 3s,
 * the engine emits 'position-lost'. Repeats every 10s while still lost.
 * Clean stream after loss: silent.
 */
import { describe, it, expect } from 'vitest';
import type { PoseLandmarks } from '@/modules/pose/types';
import type { CalibrationUpdate } from '@/modules/squat/types';
import { FireHydrantEngine } from '@/modules/fire-hydrant/engine';
import type { WarningType } from '@/store/workout';

function buildValidPose(vis = 0.95): PoseLandmarks {
  const SHOULDER_X = 0.68;
  const SHOULDER_Y = 0.42;
  const HIP_X = 0.45;
  const HIP_Y = 0.42;
  const L_THIGH = 0.18;
  const L_SHIN = 0.18;
  const lm: PoseLandmarks = Array.from({ length: 33 }, () => ({
    x: 0.5, y: 0.5, z: 0, visibility: 0.1,
  })) as unknown as PoseLandmarks;
  lm[11] = { x: SHOULDER_X, y: SHOULDER_Y, z: 0, visibility: vis };
  lm[12] = { x: SHOULDER_X, y: SHOULDER_Y + 0.01, z: 0, visibility: vis * 0.7 };
  lm[23] = { x: HIP_X, y: HIP_Y, z: 0, visibility: vis };
  lm[24] = { x: HIP_X, y: HIP_Y + 0.01, z: 0, visibility: vis * 0.7 };
  lm[25] = { x: HIP_X, y: HIP_Y + L_THIGH, z: 0, visibility: vis };
  lm[26] = { x: HIP_X, y: HIP_Y + L_THIGH, z: 0, visibility: vis * 0.6 };
  lm[27] = { x: HIP_X - L_SHIN, y: HIP_Y + L_THIGH + L_SHIN * 0.3, z: 0, visibility: vis };
  lm[28] = { x: HIP_X - L_SHIN, y: HIP_Y + L_THIGH + L_SHIN * 0.3, z: 0, visibility: vis * 0.6 };
  lm[15] = { x: SHOULDER_X + 0.12, y: SHOULDER_Y + 0.32, z: 0, visibility: vis };
  lm[16] = { x: SHOULDER_X - 0.23, y: SHOULDER_Y + 0.32, z: 0, visibility: vis * 0.7 };
  return lm;
}

function buildInvisiblePose(): PoseLandmarks {
  return Array.from({ length: 33 }, () => ({
    x: 0.5, y: 0.5, z: 0, visibility: 0.0,
  })) as unknown as PoseLandmarks;
}

function runPositionLostTest(scenarios: Array<{ tMs: number; pose: PoseLandmarks | null }>): {
  warnings: Array<{ type: WarningType; atMs: number }>;
  calibrationConfirmedAtMs: number | null;
} {
  const warnings: Array<{ type: WarningType; atMs: number }> = [];
  let calConfirmedAt: number | null = null;
  let currentTMs = 0;

  const engine = new FireHydrantEngine({
    onCalibrationUpdate: (u: CalibrationUpdate) => {
      if (u.state === 'confirmed' && calConfirmedAt === null) calConfirmedAt = currentTMs;
    },
    onPostureWarning: (type) => warnings.push({ type, atMs: currentTMs }),
  });

  for (const s of scenarios) {
    currentTMs = s.tMs;
    engine.update(s.pose, s.tMs);
  }
  engine.finish();
  return { warnings, calibrationConfirmedAtMs: calConfirmedAt };
}

function buildFrameSeq(phasesFn: (t: number) => PoseLandmarks | null, totalMs: number, fps = 30) {
  const frames: Array<{ tMs: number; pose: PoseLandmarks | null }> = [];
  const step = 1000 / fps;
  for (let t = 0; t <= totalMs; t += step) {
    frames.push({ tMs: t, pose: phasesFn(t) });
  }
  return frames;
}

describe('Fire Hydrant — position-lost (Fix N)', () => {
  it('fires position-lost after 4s of null frames post-calibration', () => {
    // Cal phase: 2.2s valid, then 5s null
    const frames = buildFrameSeq((t) => {
      if (t <= 2200) return buildValidPose();
      return buildInvisiblePose();
    }, 8000);

    const result = runPositionLostTest(frames);
    expect(result.calibrationConfirmedAtMs).not.toBeNull();
    const posLost = result.warnings.filter((w) => w.type === 'position-lost');
    expect(posLost.length).toBeGreaterThanOrEqual(1);
    // Must fire at least 3s after last valid frame
    expect(posLost[0].atMs).toBeGreaterThan(2200 + 2500);
  });

  it('does NOT fire position-lost on a clean stream', () => {
    const frames = buildFrameSeq(() => buildValidPose(), 10000);
    const result = runPositionLostTest(frames);
    const posLost = result.warnings.filter((w) => w.type === 'position-lost');
    expect(posLost.length).toBe(0);
  });

  it('fires twice when lost for > 13s (10s repeat interval)', () => {
    const frames = buildFrameSeq((t) => {
      if (t <= 2200) return buildValidPose();
      return buildInvisiblePose();
    }, 20000);

    const result = runPositionLostTest(frames);
    const posLost = result.warnings.filter((w) => w.type === 'position-lost');
    expect(posLost.length).toBeGreaterThanOrEqual(2);
  });

  it('recovers silently when landmarks return within 3s', () => {
    // 2s valid → 2s null (under threshold) → valid again
    const frames = buildFrameSeq((t) => {
      if (t <= 2200) return buildValidPose();
      if (t <= 4200) return buildInvisiblePose(); // 2s gap (< 3s threshold)
      return buildValidPose();
    }, 8000);

    const result = runPositionLostTest(frames);
    const posLost = result.warnings.filter((w) => w.type === 'position-lost');
    expect(posLost.length).toBe(0);
  });

  it('does NOT fire before calibration confirms', () => {
    // Never calibrate (no valid pose), just feed null frames for 10s
    const frames = buildFrameSeq(() => buildInvisiblePose(), 10000);
    const result = runPositionLostTest(frames);
    const posLost = result.warnings.filter((w) => w.type === 'position-lost');
    expect(posLost.length).toBe(0);
  });
});
