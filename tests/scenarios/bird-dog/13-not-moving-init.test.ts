/**
 * Regression test for bird-dog Fix I + Fix P — not-moving init.
 *
 * standingSince (restSince) must be initialized to `now` on calibration
 * confirm, not left at 0. If left at 0, the first post-cal frame would report
 * idleMs = (now - 0) = millions, immediately firing 'not-moving'.
 *
 * Also verifies NO_MOVEMENT_TIMEOUT_MS=5000: idle fires at ~5s, not before.
 */
import { describe, it, expect } from 'vitest';
import type { PoseLandmarks } from '@/modules/pose/types';
import type { CalibrationUpdate } from '@/modules/squat/types';
import { BirdDogEngine } from '@/modules/bird-dog/engine';
import type { BirdDogFrameMetrics } from '@/modules/bird-dog/types';
import type { WarningType } from '@/store/workout';
import type { Frame } from '../../harness/types';
import { buildFrames } from '../../harness/frame-stream';

// ---------------------------------------------------------------------------
// Pose builder (always at-rest quadruped pose)
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
// Tests
// ---------------------------------------------------------------------------
describe('Bird-Dog — regression: no immediate not-moving after calibration (Fix I + Fix P)', () => {
  it('does NOT fire not-moving within the first 3s after calibration confirms', () => {
    // Calibration confirms in ~200ms. Run ~3 more seconds of at-rest.
    // Total ~3.2s, well under the 5s threshold.
    const frames = buildFrames(
      () => null as never, // intent not used — use landmarks directly
      buildBirdDogAtRest,  // builder ignores intent
      { fps: 30, durationMs: 3200 },
    );

    // Override: build frames with the pose directly (intent is unused here)
    const directFrames: Frame[] = [];
    for (let t = 0; t < 3200; t += 1000 / 30) {
      directFrames.push({ landmarks: buildBirdDogAtRest(), tMs: t });
    }

    const result = runBirdDogLocal(directFrames);

    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThan(500);
    expect(countWarnings(result, 'not-moving')).toBe(0);
  });

  it('DOES fire not-moving after sustained idle past 5s post-calibration', () => {
    // 8.5s of at-rest — must fire not-moving at ~5s mark
    const directFrames: Frame[] = [];
    for (let t = 0; t < 8500; t += 1000 / 30) {
      directFrames.push({ landmarks: buildBirdDogAtRest(), tMs: t });
    }

    const result = runBirdDogLocal(directFrames);

    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'not-moving')).toBeGreaterThan(0);
  });

  it('first not-moving fires at or after the 5s threshold (not instantaneously on cal-confirm)', () => {
    // 8s total: ~200ms calibration, then ~7.8s idle
    const directFrames: Frame[] = [];
    for (let t = 0; t < 8000; t += 1000 / 30) {
      directFrames.push({ landmarks: buildBirdDogAtRest(), tMs: t });
    }

    const result = runBirdDogLocal(directFrames);

    expect(result.finalCalibration?.state).toBe('confirmed');
    const notMovingWarnings = result.warnings.filter((w) => w.type === 'not-moving');
    expect(notMovingWarnings.length).toBeGreaterThan(0);

    const calConfirmedMs = result.calibrationConfirmedAtMs ?? 0;
    // First not-moving must fire at least 5000ms after calibration confirmed
    const firstWarningMs = notMovingWarnings[0].atMs;
    expect(firstWarningMs - calConfirmedMs).toBeGreaterThanOrEqual(4500); // allow 500ms tolerance
  });
});
