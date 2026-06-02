/**
 * Bird-Dog happy-path tests.
 * Uses a local runner (Integration Agent will wire runBirdDogSession to harness).
 */
import { describe, it, expect } from 'vitest';
import type { PoseLandmarks } from '@/modules/pose/types';
import type { CalibrationUpdate } from '@/modules/squat/types';
import { BirdDogEngine } from '@/modules/bird-dog/engine';
import type { BirdDogRepEvent, BirdDogFrameMetrics } from '@/modules/bird-dog/types';
import type { WarningType } from '@/store/workout';
import type { Frame } from '../../harness/types';
import { buildFrames } from '../../harness/frame-stream';

// ---------------------------------------------------------------------------
// Minimal local pose builder (side camera, user facing right)
// legExtension: 0 = at rest (hipKneeAngle ~90°), 1 = fully extended (~165°)
// ---------------------------------------------------------------------------
function buildBirdDogPoseLocal(intent: {
  legExtension: number;
  bodySpan?: number;
  visibility?: number;
}): PoseLandmarks {
  const span = intent.bodySpan ?? 0.60;
  const ext = Math.max(0, Math.min(1, intent.legExtension));
  const vis = intent.visibility ?? 0.95;

  // Side camera geometry (user facing right) — corrected for engine angles
  const shoulderX = 0.68;
  const shoulderY = 0.42;
  const hipX = 0.45;
  const hipY = 0.42;  // same height = body horizontal ✓
  // Rotation model: thigh rotates 75° CCW from "pointing down" as ext goes 0→1.
  // Shin always points LEFT (backward direction). This gives:
  //   ext=0: angle ≈ 90°, extension ≈ 0° (AT_REST)
  //   ext=0.375: angle ≈ 118°, extension ≈ 28° (above EXTEND_START=20°)
  //   ext=0.875: angle ≈ 156°, extension ≈ 66° (above AT_EXTENDED=50°)
  //   ext=1.0: angle ≈ 165°, extension ≈ 75°
  const rotRad = ext * 75 * Math.PI / 180;
  const kneeX = hipX - 0.18 * Math.sin(rotRad);
  const kneeY = hipY + 0.18 * Math.cos(rotRad);
  const ankleX = kneeX - 0.22; // shin points LEFT (backward)
  const ankleY = kneeY;
  // Wrist below shoulder (hands on floor)
  const wristX = shoulderX + 0.12;
  const wristY = shoulderY + 0.32;  // below shoulder

  // Build 33-landmark array (only key ones need real values)
  const lm: PoseLandmarks = Array.from({ length: 33 }, () => ({
    x: 0.5, y: 0.5, z: 0, visibility: 0.1,
  })) as unknown as PoseLandmarks;

  // Right side (dominant for user facing right in side view)
  // Use right side landmarks (indices 12, 24, 26, 28)
  lm[11] = { x: shoulderX, y: shoulderY, z: 0, visibility: vis }; // left shoulder (behind)
  lm[12] = { x: shoulderX, y: shoulderY, z: 0, visibility: vis }; // right shoulder
  lm[23] = { x: hipX, y: hipY, z: 0, visibility: vis };           // left hip
  lm[24] = { x: hipX, y: hipY, z: 0, visibility: vis };           // right hip
  lm[25] = { x: kneeX, y: kneeY, z: 0, visibility: vis };         // left knee
  lm[26] = { x: kneeX, y: kneeY, z: 0, visibility: vis };         // right knee
  lm[27] = { x: ankleX, y: ankleY, z: 0, visibility: vis };       // left ankle
  lm[28] = { x: ankleX, y: ankleY, z: 0, visibility: vis };       // right ankle
  lm[15] = { x: wristX, y: wristY, z: 0, visibility: vis };       // left wrist
  lm[16] = { x: wristX, y: wristY, z: 0, visibility: vis };       // right wrist

  // Scale horizontal span
  const currentSpan = Math.abs(ankleX - shoulderX);
  const scaleFactor = span / (currentSpan || 0.46);
  const cx = (shoulderX + ankleX) / 2;
  for (const idx of [11, 12, 23, 24, 25, 26, 27, 28, 15, 16]) {
    lm[idx] = { ...lm[idx], x: cx + (lm[idx].x - cx) * scaleFactor };
  }

  return lm;
}

// ---------------------------------------------------------------------------
// Local runner
// ---------------------------------------------------------------------------
interface RunResult {
  completedReps: BirdDogRepEvent[];
  warnings: Array<{ type: WarningType; atMs: number }>;
  finalCalibration: CalibrationUpdate | null;
  calibrationConfirmedAtMs: number | null;
  frameMetricsSamples: BirdDogFrameMetrics[];
}

function runBirdDogLocal(frames: Frame[]): RunResult {
  const completedReps: BirdDogRepEvent[] = [];
  const warnings: Array<{ type: WarningType; atMs: number }> = [];
  const frameMetricsSamples: BirdDogFrameMetrics[] = [];
  let finalCalibration: CalibrationUpdate | null = null;
  let calibrationConfirmedAtMs: number | null = null;
  let currentTMs = 0;

  const engine = new BirdDogEngine({
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
// Rep cycle helper: calibrate 2.2s, then rep cycle at given extensionPeak
// ---------------------------------------------------------------------------
function happyPathIntent(reps: number, extensionPeakDeg = 70) {
  const calMs = 2200;
  const repCycleMs = 3000;
  const totalMs = calMs + reps * repCycleMs;

  return {
    totalMs,
    intentAt: (tMs: number) => {
      if (tMs < calMs) {
        return { legExtension: 0 };
      }
      const tInRep = (tMs - calMs) % repCycleMs;
      const maxExt = extensionPeakDeg / 80; // normalize (80° ≈ full extension)
      let legExtension: number;
      if (tInRep < 800) {
        // extending: 0 → peak
        legExtension = (tInRep / 800) * maxExt;
      } else if (tInRep < 1400) {
        // hold at peak
        legExtension = maxExt;
      } else if (tInRep < 2200) {
        // returning: peak → 0
        legExtension = maxExt - ((tInRep - 1400) / 800) * maxExt;
      } else {
        // rest
        legExtension = 0;
      }
      return { legExtension: Math.max(0, legExtension) };
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('Bird-Dog — happy path', () => {
  it('calibrates within 2300ms and counts 6 clean reps', () => {
    const { totalMs, intentAt } = happyPathIntent(6);
    const frames = buildFrames(intentAt, buildBirdDogPoseLocal, { fps: 30, durationMs: totalMs });

    const result = runBirdDogLocal(frames);

    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThanOrEqual(2300);
    expect(result.completedReps.length).toBeGreaterThanOrEqual(6);
    expect(warningsOtherThan(result, 'not-moving').length).toBe(0);

    const avgMqs = result.completedReps.reduce((sum, r) => sum + r.mqs, 0) / result.completedReps.length;
    expect(avgMqs).toBeGreaterThanOrEqual(60);
  });

  it('counts 3 reps when given a 3-rep stream', () => {
    const { totalMs, intentAt } = happyPathIntent(3);
    const frames = buildFrames(intentAt, buildBirdDogPoseLocal, { fps: 30, durationMs: totalMs });
    const result = runBirdDogLocal(frames);
    expect(result.completedReps.length).toBeGreaterThanOrEqual(3);
  });

  it('calibration state is confirmed after calibration phase', () => {
    const { totalMs, intentAt } = happyPathIntent(3);
    const frames = buildFrames(intentAt, buildBirdDogPoseLocal, { fps: 30, durationMs: totalMs });
    const result = runBirdDogLocal(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
  });

  it('all reps score mqs >= 50', () => {
    const { totalMs, intentAt } = happyPathIntent(3);
    const frames = buildFrames(intentAt, buildBirdDogPoseLocal, { fps: 30, durationMs: totalMs });
    const result = runBirdDogLocal(frames);
    expect(result.completedReps.length).toBeGreaterThanOrEqual(3);
    result.completedReps.forEach((rep) => {
      expect(rep.mqs).toBeGreaterThanOrEqual(50);
    });
  });

  it('no incomplete-bird-dog warnings on clean full-extension reps', () => {
    const { totalMs, intentAt } = happyPathIntent(3, 70);
    const frames = buildFrames(intentAt, buildBirdDogPoseLocal, { fps: 30, durationMs: totalMs });
    const result = runBirdDogLocal(frames);
    expect(countWarnings(result, 'incomplete-bird-dog' as WarningType)).toBe(0);
  });
});
