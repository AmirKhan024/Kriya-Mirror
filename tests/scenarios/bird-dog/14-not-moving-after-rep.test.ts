/**
 * Regression test for bird-dog Fix O — EMA-decay reseed.
 *
 * Bug: after completing a rep, the post-rep EMA-decay tail (smoothedExtension
 * drifting from ~20° back to 0° over several seconds) permanently inflates the
 * min-max variance window, so 'not-moving' never fires during the idle period.
 *
 * Fix: once the EMA has settled (per-frame Δ < 0.3° for 500ms), drop the
 * cached min/max and reseed from the current value.
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
// Pose builders
// ---------------------------------------------------------------------------
function buildBirdDogPose(legExtension: number): PoseLandmarks {
  const ext = Math.max(0, Math.min(1, legExtension));
  const vis = 0.95;
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
// Local runner
// ---------------------------------------------------------------------------
interface RunResult {
  completedReps: Array<{ depthDeg: number; mqs: number }>;
  warnings: Array<{ type: WarningType; atMs: number }>;
  finalCalibration: CalibrationUpdate | null;
  calibrationConfirmedAtMs: number | null;
}

function runBirdDogLocal(frames: Frame[]): RunResult {
  const completedReps: Array<{ depthDeg: number; mqs: number }> = [];
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
    onRepComplete: (r) => completedReps.push({ depthDeg: r.depthDeg, mqs: r.mqs }),
    onPostureWarning: (type) => warnings.push({ type, atMs: currentTMs }),
    onFrame: (_: BirdDogFrameMetrics) => {},
  });

  for (const frame of frames) {
    currentTMs = frame.tMs;
    engine.update(frame.landmarks, frame.tMs);
  }
  engine.finish();

  return { completedReps, warnings, finalCalibration, calibrationConfirmedAtMs };
}

function countWarnings(result: RunResult, type: WarningType): number {
  return result.warnings.filter((w) => w.type === type).length;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('Bird-Dog — regression: not-moving fires after a real rep + idle (Fix O)', () => {
  const CAL_MS = 2200;

  it('DOES fire not-moving when user rests in AT_REST after completing a rep', () => {
    // Profile: calibrate → one full rep (0 → 70° → 0 over 2.5s) → 8s idle
    // Total = 2.2 + 2.5 + 8 = 12.7s
    const REP_END_MS = CAL_MS + 2500;
    const TOTAL_MS = REP_END_MS + 8000;
    const FULL_EXT = 0.875; // ~70°

    const frames: Frame[] = [];
    const dt = 1000 / 30;

    for (let t = 0; t < TOTAL_MS; t += dt) {
      let landmarks: PoseLandmarks;
      if (t < CAL_MS) {
        landmarks = buildBirdDogPose(0); // calibration
      } else if (t < REP_END_MS) {
        // Real rep: 0 → peak over 1s, hold 0.5s, return over 1s
        const tInRep = t - CAL_MS;
        let ext: number;
        if (tInRep < 1000) ext = (tInRep / 1000) * FULL_EXT;
        else if (tInRep < 1500) ext = FULL_EXT;
        else ext = FULL_EXT - ((tInRep - 1500) / 1000) * FULL_EXT;
        landmarks = buildBirdDogPose(Math.max(0, ext));
      } else {
        landmarks = buildBirdDogPose(0); // post-rep idle
      }
      frames.push({ landmarks, tMs: t });
    }

    const result = runBirdDogLocal(frames);

    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThan(500);
    // Must have counted a rep
    expect(result.completedReps.length).toBeGreaterThanOrEqual(1);
    // The whole point: not-moving must fire post-rep
    expect(countWarnings(result, 'not-moving')).toBeGreaterThanOrEqual(1);
  });

  it('not-moving fires only after the 5s idle threshold, not immediately after rep', () => {
    // Rep completes, then short rest (3s) — should NOT fire not-moving yet
    const REP_END_MS = CAL_MS + 2500;
    const TOTAL_MS = REP_END_MS + 3000; // only 3s idle — under 5s threshold
    const FULL_EXT = 0.875;

    const frames: Frame[] = [];
    const dt = 1000 / 30;
    for (let t = 0; t < TOTAL_MS; t += dt) {
      let landmarks: PoseLandmarks;
      if (t < CAL_MS) {
        landmarks = buildBirdDogPose(0);
      } else if (t < REP_END_MS) {
        const tInRep = t - CAL_MS;
        let ext: number;
        if (tInRep < 1000) ext = (tInRep / 1000) * FULL_EXT;
        else if (tInRep < 1500) ext = FULL_EXT;
        else ext = FULL_EXT - ((tInRep - 1500) / 1000) * FULL_EXT;
        landmarks = buildBirdDogPose(Math.max(0, ext));
      } else {
        landmarks = buildBirdDogPose(0);
      }
      frames.push({ landmarks, tMs: t });
    }

    const result = runBirdDogLocal(frames);
    // Only 3s of idle after rep — should NOT fire not-moving (5s threshold)
    expect(countWarnings(result, 'not-moving')).toBe(0);
  });
});
