/**
 * Regression tests for Bird-Dog Fix N — position-lost warning.
 *
 * Spec: if no usable pose frame (landmarks null OR core body landmarks not
 * visible) for ≥ 3 seconds post-calibration, the engine emits 'position-lost'.
 * Repeats at most every 10s while the pose is still absent.
 */
import { describe, it, expect } from 'vitest';
import type { PoseLandmarks } from '@/modules/pose/types';
import type { CalibrationUpdate } from '@/modules/squat/types';
import { BirdDogEngine } from '@/modules/bird-dog/engine';
import type { BirdDogFrameMetrics } from '@/modules/bird-dog/types';
import type { WarningType } from '@/store/workout';
import type { Frame } from '../../harness/types';

const CAL_MS = 2200;
const FPS = 30;
const DT = 1000 / FPS;

// ---------------------------------------------------------------------------
// Pose builder (side camera, at-rest quadruped)
// ---------------------------------------------------------------------------
function buildBirdDogAtRest(): PoseLandmarks {
  const vis = 0.95;
  const lm: PoseLandmarks = Array.from({ length: 33 }, () => ({
    x: 0.5, y: 0.5, z: 0, visibility: 0.1,
  })) as unknown as PoseLandmarks;
  // Corrected geometry: hip=(0.45, 0.42), knee below hip, ankle to left of knee
  // → hip-knee-ankle ≈ 90° → rawExtension ≈ 0° (AT_REST)
  lm[11] = { x: 0.68, y: 0.42, z: 0, visibility: vis }; // left shoulder
  lm[12] = { x: 0.68, y: 0.42, z: 0, visibility: vis }; // right shoulder
  lm[23] = { x: 0.45, y: 0.42, z: 0, visibility: vis }; // left hip
  lm[24] = { x: 0.45, y: 0.42, z: 0, visibility: vis }; // right hip
  lm[25] = { x: 0.45, y: 0.66, z: 0, visibility: vis }; // left knee (below hip)
  lm[26] = { x: 0.45, y: 0.66, z: 0, visibility: vis }; // right knee
  lm[27] = { x: 0.25, y: 0.66, z: 0, visibility: vis }; // left ankle (to left of knee)
  lm[28] = { x: 0.25, y: 0.66, z: 0, visibility: vis }; // right ankle
  lm[15] = { x: 0.80, y: 0.74, z: 0, visibility: vis }; // left wrist (below shoulder)
  lm[16] = { x: 0.80, y: 0.74, z: 0, visibility: vis }; // right wrist
  return lm;
}

// ---------------------------------------------------------------------------
// Local runner
// ---------------------------------------------------------------------------
interface RunResult {
  warnings: Array<{ type: WarningType; atMs: number }>;
  finalCalibration: CalibrationUpdate | null;
  calibrationConfirmedAtMs: number | null;
}

function runBirdDogLocal(frames: Frame[]): RunResult {
  const warnings: Array<{ type: WarningType; atMs: number }> = [];
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
    onPostureWarning: (type) => warnings.push({ type, atMs: currentTMs }),
    onFrame: (_: BirdDogFrameMetrics) => {},
  });

  for (const frame of frames) {
    currentTMs = frame.tMs;
    engine.update(frame.landmarks, frame.tMs);
  }
  engine.finish();

  return { warnings, finalCalibration, calibrationConfirmedAtMs };
}

function countWarnings(result: RunResult, type: WarningType): number {
  return result.warnings.filter((w) => w.type === type).length;
}

// ---------------------------------------------------------------------------
// Frame builders
// ---------------------------------------------------------------------------
function buildCalibrationFrames(): Frame[] {
  const frames: Frame[] = [];
  for (let t = 0; t < CAL_MS; t += DT) {
    frames.push({ landmarks: buildBirdDogAtRest(), tMs: t });
  }
  return frames;
}

function buildNullFrames(startMs: number, durationMs: number): Frame[] {
  const frames: Frame[] = [];
  for (let t = 0; t < durationMs; t += DT) {
    frames.push({ landmarks: null, tMs: startMs + t });
  }
  return frames;
}

function buildValidFrames(startMs: number, durationMs: number): Frame[] {
  const frames: Frame[] = [];
  for (let t = 0; t < durationMs; t += DT) {
    frames.push({ landmarks: buildBirdDogAtRest(), tMs: startMs + t });
  }
  return frames;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('Bird-Dog — position-lost warning (Fix N)', () => {
  it('fires position-lost after 3+ seconds of null landmarks post-calibration', () => {
    const calFrames = buildCalibrationFrames();
    const nullFrames = buildNullFrames(CAL_MS, 4000); // 4s of null post-cal

    const result = runBirdDogLocal([...calFrames, ...nullFrames]);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'position-lost')).toBeGreaterThan(0);
  });

  it('does NOT fire position-lost on a clean continuous stream', () => {
    const frames = buildValidFrames(0, 5000); // 5s of valid frames
    const result = runBirdDogLocal(frames);
    expect(countWarnings(result, 'position-lost')).toBe(0);
  });

  it('does NOT fire position-lost during the calibration phase (before confirm)', () => {
    // Null frames during calibration phase → position-lost must NOT fire
    const nullDuringCal: Frame[] = [];
    for (let t = 0; t < 1500; t += DT) {
      nullDuringCal.push({ landmarks: null, tMs: t });
    }
    // Come into frame at 1.5s; calibration proceeds from here
    const calAfter = buildValidFrames(1500, 2500);

    const result = runBirdDogLocal([...nullDuringCal, ...calAfter]);
    expect(countWarnings(result, 'position-lost')).toBe(0);
  });

  it('does NOT re-fire position-lost within the 10s cooldown', () => {
    // 5s of null post-cal — should fire exactly once (at the 3s mark)
    // The 10s cooldown prevents a second fire within this window
    const calFrames = buildCalibrationFrames();
    const nullFrames = buildNullFrames(CAL_MS, 5000);

    const result = runBirdDogLocal([...calFrames, ...nullFrames]);
    expect(countWarnings(result, 'position-lost')).toBe(1);
  });

  it('fires again after 10s cooldown has elapsed', () => {
    // 15s of null post-cal — should fire twice (at ~3s and ~13s)
    const calFrames = buildCalibrationFrames();
    const nullFrames = buildNullFrames(CAL_MS, 15000);

    const result = runBirdDogLocal([...calFrames, ...nullFrames]);
    expect(countWarnings(result, 'position-lost')).toBeGreaterThanOrEqual(2);
  });

  it('stops firing position-lost when valid landmarks resume', () => {
    // 4s null → 3s valid → total should be exactly 1 position-lost
    const calFrames = buildCalibrationFrames();
    const nullFrames = buildNullFrames(CAL_MS, 4000);
    const resumeFrames = buildValidFrames(CAL_MS + 4000, 3000);

    const result = runBirdDogLocal([...calFrames, ...nullFrames, ...resumeFrames]);
    expect(countWarnings(result, 'position-lost')).toBe(1);
  });
});
