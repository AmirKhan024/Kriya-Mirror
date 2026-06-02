/**
 * Bird-Dog warning gating tests (Fix A).
 *
 * For bird-dog there are no continuous posture warnings (no hip-lift, no trunk-forward).
 * Fix A rule: posture warnings must NOT fire during AT_EXTENDED.
 *
 * This test suite verifies:
 * 1. A clean full-hold rep generates no unexpected warnings.
 * 2. 'incomplete-bird-dog' only fires at rep completion, not mid-rep.
 * 3. The warning gating is correct relative to rep state.
 */
import { describe, it, expect } from 'vitest';
import type { PoseLandmarks } from '@/modules/pose/types';
import type { CalibrationUpdate } from '@/modules/squat/types';
import { BirdDogEngine } from '@/modules/bird-dog/engine';
import type { BirdDogRepEvent, BirdDogFrameMetrics, BirdDogRepState } from '@/modules/bird-dog/types';
import type { WarningType } from '@/store/workout';
import type { Frame } from '../../harness/types';
import { buildFrames } from '../../harness/frame-stream';

// ---------------------------------------------------------------------------
// Pose builder
// ---------------------------------------------------------------------------
function buildBirdDogPoseLocal(intent: { legExtension: number; visibility?: number }): PoseLandmarks {
  const ext = Math.max(0, Math.min(1, intent.legExtension));
  const vis = intent.visibility ?? 0.95;
  const shoulderX = 0.68; const shoulderY = 0.42;
  const hipX = 0.45; const hipY = 0.42;
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
// Local runner — tracks state transitions alongside warnings
// ---------------------------------------------------------------------------
interface RunResult {
  completedReps: BirdDogRepEvent[];
  warnings: Array<{ type: WarningType; atMs: number }>;
  repStateAtWarning: Array<{ type: WarningType; state: BirdDogRepState }>;
  finalCalibration: CalibrationUpdate | null;
  calibrationConfirmedAtMs: number | null;
}

function runBirdDogLocal(frames: Frame[]): RunResult {
  const completedReps: BirdDogRepEvent[] = [];
  const warnings: Array<{ type: WarningType; atMs: number }> = [];
  const repStateAtWarning: Array<{ type: WarningType; state: BirdDogRepState }> = [];
  let finalCalibration: CalibrationUpdate | null = null;
  let calibrationConfirmedAtMs: number | null = null;
  let currentTMs = 0;
  let latestState: BirdDogRepState = 'AT_REST';

  const engine = new BirdDogEngine({
    onCalibrationUpdate: (u) => {
      finalCalibration = u;
      if (u.state === 'confirmed' && calibrationConfirmedAtMs === null) {
        calibrationConfirmedAtMs = currentTMs;
      }
    },
    onRepComplete: (r) => completedReps.push(r),
    onPostureWarning: (type) => {
      warnings.push({ type, atMs: currentTMs });
      repStateAtWarning.push({ type, state: latestState });
    },
    onFrame: (m: BirdDogFrameMetrics) => {
      latestState = m.repState;
    },
  });

  for (const frame of frames) {
    currentTMs = frame.tMs;
    engine.update(frame.landmarks, frame.tMs);
  }
  engine.finish();

  return { completedReps, warnings, repStateAtWarning, finalCalibration, calibrationConfirmedAtMs };
}

function countWarnings(result: RunResult, type: WarningType): number {
  return result.warnings.filter((w) => w.type === type).length;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('Bird-Dog — warning gating (Fix A)', () => {
  const CAL_MS = 2200;

  it('no unexpected warnings during a clean 3-rep session', () => {
    const repCycleMs = 3000;
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) return { legExtension: 0 };
        const tInRep = (tMs - CAL_MS) % repCycleMs;
        const FULL_EXT = 0.875;
        if (tInRep < 800) return { legExtension: (tInRep / 800) * FULL_EXT };
        if (tInRep < 1400) return { legExtension: FULL_EXT };
        if (tInRep < 2200) return { legExtension: FULL_EXT - ((tInRep - 1400) / 800) * FULL_EXT };
        return { legExtension: 0 };
      },
      buildBirdDogPoseLocal,
      { fps: 30, durationMs: CAL_MS + 3 * repCycleMs },
    );

    const result = runBirdDogLocal(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.completedReps.length).toBeGreaterThanOrEqual(3);

    // No form warnings on clean session
    expect(countWarnings(result, 'incomplete-bird-dog' as WarningType)).toBe(0);
    expect(countWarnings(result, 'malformed-rep')).toBe(0);
    expect(countWarnings(result, 'position-lost')).toBe(0);
  });

  it('engine emits no warnings when AT_EXTENDED and all frames are clean', () => {
    // Build a rep that reaches AT_EXTENDED (stable 5 frames at >50°) and holds
    const repCycleMs = 4000;
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) return { legExtension: 0 };
        const tInRep = (tMs - CAL_MS) % repCycleMs;
        const FULL_EXT = 0.875; // ~70°
        if (tInRep < 1000) return { legExtension: (tInRep / 1000) * FULL_EXT };
        if (tInRep < 2000) return { legExtension: FULL_EXT }; // long hold at peak (>5 frames)
        if (tInRep < 3000) return { legExtension: FULL_EXT - ((tInRep - 2000) / 1000) * FULL_EXT };
        return { legExtension: 0 };
      },
      buildBirdDogPoseLocal,
      { fps: 30, durationMs: CAL_MS + 2 * repCycleMs },
    );

    const result = runBirdDogLocal(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    // Reps should be valid (reached AT_EXTENDED)
    expect(result.completedReps.length).toBeGreaterThanOrEqual(2);
    // No form warnings
    expect(countWarnings(result, 'incomplete-bird-dog' as WarningType)).toBe(0);
    expect(countWarnings(result, 'malformed-rep')).toBe(0);
  });

  it('incomplete-bird-dog fires at rep completion (AT_REST entry), not during AT_EXTENDED', () => {
    // Shallow rep: peak ~30° — incomplete-bird-dog fires on rep completion
    const SHALLOW_EXT = 0.375;
    const repCycleMs = 2000;
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) return { legExtension: 0 };
        const tInRep = (tMs - CAL_MS) % repCycleMs;
        if (tInRep < 700) return { legExtension: (tInRep / 700) * SHALLOW_EXT };
        if (tInRep < 1000) return { legExtension: SHALLOW_EXT };
        return { legExtension: SHALLOW_EXT - ((tInRep - 1000) / 1000) * SHALLOW_EXT };
      },
      buildBirdDogPoseLocal,
      { fps: 30, durationMs: CAL_MS + repCycleMs * 2 },
    );

    const result = runBirdDogLocal(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');

    // When incomplete-bird-dog fires, repState should be AT_REST (rep just completed)
    const incompleteWarnings = result.repStateAtWarning.filter(
      (w) => w.type === ('incomplete-bird-dog' as WarningType),
    );
    incompleteWarnings.forEach((w) => {
      // Warning fires at rep completion — state is RETURNING (just before AT_REST) or AT_REST.
      // The engine fires the warning inside completeRep() which runs during the RETURNING→AT_REST
      // transition, so the captured repState may be either RETURNING or AT_REST.
      expect(['RETURNING', 'AT_REST']).toContain(w.state);
    });
  });
});
