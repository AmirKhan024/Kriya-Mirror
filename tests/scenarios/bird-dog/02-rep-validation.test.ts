/**
 * Bird-Dog rep validation tests.
 * Verifies that shallow reps fire 'incomplete-bird-dog' and fast reps fire 'malformed-rep'.
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
// Minimal local pose builder (side camera)
// ---------------------------------------------------------------------------
function buildBirdDogPoseLocal(intent: { legExtension: number; visibility?: number }): PoseLandmarks {
  const ext = Math.max(0, Math.min(1, intent.legExtension));
  const vis = intent.visibility ?? 0.95;

  const shoulderX = 0.68;
  const shoulderY = 0.42;
  const hipX = 0.45;
  const hipY = 0.42;
  const rotRad = ext * 75 * Math.PI / 180;
  const kneeX = hipX - 0.18 * Math.sin(rotRad);
  const kneeY = hipY + 0.18 * Math.cos(rotRad);
  const ankleX = kneeX - 0.22;
  const ankleY = kneeY;
  const wristX = shoulderX + 0.12;
  const wristY = shoulderY + 0.32;

  const lm: PoseLandmarks = Array.from({ length: 33 }, () => ({
    x: 0.5, y: 0.5, z: 0, visibility: 0.1,
  })) as unknown as PoseLandmarks;

  lm[11] = { x: shoulderX, y: shoulderY, z: 0, visibility: vis };
  lm[12] = { x: shoulderX, y: shoulderY, z: 0, visibility: vis };
  lm[23] = { x: hipX, y: hipY, z: 0, visibility: vis };
  lm[24] = { x: hipX, y: hipY, z: 0, visibility: vis };
  lm[25] = { x: kneeX, y: kneeY, z: 0, visibility: vis };
  lm[26] = { x: kneeX, y: kneeY, z: 0, visibility: vis };
  lm[27] = { x: ankleX, y: ankleY, z: 0, visibility: vis };
  lm[28] = { x: ankleX, y: ankleY, z: 0, visibility: vis };
  lm[15] = { x: wristX, y: wristY, z: 0, visibility: vis };
  lm[16] = { x: wristX, y: wristY, z: 0, visibility: vis };

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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('Bird-Dog — rep validation', () => {
  const CAL_MS = 2200;

  it('shallow rep (peak extensionDeg ~30° < 45°) fires incomplete-bird-dog and is NOT counted', () => {
    // extensionDeg ~30° → legExtension ~ 0.375 (30/80)
    const SHALLOW_EXT = 0.375;
    const repCycleMs = 2000;
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) return { legExtension: 0 };
        const tInRep = (tMs - CAL_MS) % repCycleMs;
        if (tInRep < 700) return { legExtension: (tInRep / 700) * SHALLOW_EXT };
        if (tInRep < 1000) return { legExtension: SHALLOW_EXT };
        return { legExtension: SHALLOW_EXT * (1 - (tInRep - 1000) / 1000) };
      },
      buildBirdDogPoseLocal,
      { fps: 30, durationMs: CAL_MS + repCycleMs },
    );

    const result = runBirdDogLocal(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    // Rep should not be counted (too shallow)
    expect(result.completedReps.length).toBe(0);
    // incomplete-bird-dog warning should fire
    expect(countWarnings(result, 'incomplete-bird-dog' as WarningType)).toBeGreaterThan(0);
  });

  it('too-fast rep (full cycle in ~400ms < 600ms) fires malformed-rep and is NOT counted', () => {
    // Profile: jump to full extension, hold 300ms (EMA catches up to 45°+), then
    // return in 100ms. Total cycle = ~400ms < MIN_REP_DURATION_MS=600ms.
    // Using FULL_EXT=1.0 so raw extension (~75°) drives EMA above AT_EXTENDED=50°
    // within the hold period, ensuring maxExtensionThisRep > MIN_REP_DEPTH_DEG=45°.
    const HOLD_MS = 300;
    const RETURN_MS = 100;
    const FAST_CYCLE_MS = HOLD_MS + RETURN_MS; // 400ms total
    const totalMs = CAL_MS + FAST_CYCLE_MS + 500; // +500ms rest
    const FULL_EXT = 1.0; // extension ~75°
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) return { legExtension: 0 };
        const tAfterCal = tMs - CAL_MS;
        if (tAfterCal < HOLD_MS) {
          // Jump immediately to full extension and hold
          return { legExtension: FULL_EXT };
        }
        if (tAfterCal < FAST_CYCLE_MS) {
          // Fast return to rest
          const t = tAfterCal - HOLD_MS;
          return { legExtension: FULL_EXT * (1 - t / RETURN_MS) };
        }
        return { legExtension: 0 };
      },
      buildBirdDogPoseLocal,
      { fps: 30, durationMs: totalMs },
    );

    const result = runBirdDogLocal(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    // Rep should not be counted
    expect(result.completedReps.length).toBe(0);
    // malformed-rep warning should fire
    expect(countWarnings(result, 'malformed-rep')).toBeGreaterThan(0);
  });

  it('good rep after a bad rep: only the good rep is counted', () => {
    const SHALLOW_EXT = 0.375;   // ~30°
    const GOOD_EXT = 0.875;      // ~70°
    const badRepMs = 2000;
    const goodRepMs = 3000;
    const totalMs = CAL_MS + badRepMs + goodRepMs;

    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) return { legExtension: 0 };
        const tAfterCal = tMs - CAL_MS;
        if (tAfterCal < badRepMs) {
          // Bad rep: shallow
          const tInRep = tAfterCal;
          if (tInRep < 700) return { legExtension: (tInRep / 700) * SHALLOW_EXT };
          if (tInRep < 1000) return { legExtension: SHALLOW_EXT };
          return { legExtension: SHALLOW_EXT * (1 - (tInRep - 1000) / 1000) };
        }
        // Good rep
        const tInGood = tAfterCal - badRepMs;
        if (tInGood < 800) return { legExtension: (tInGood / 800) * GOOD_EXT };
        if (tInGood < 1400) return { legExtension: GOOD_EXT };
        if (tInGood < 2200) return { legExtension: GOOD_EXT * (1 - (tInGood - 1400) / 800) };
        return { legExtension: 0 };
      },
      buildBirdDogPoseLocal,
      { fps: 30, durationMs: totalMs },
    );

    const result = runBirdDogLocal(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    // Only 1 good rep counted
    expect(result.completedReps.length).toBe(1);
    // incomplete-bird-dog should have fired for the bad rep
    expect(countWarnings(result, 'incomplete-bird-dog' as WarningType)).toBeGreaterThan(0);
  });
});
