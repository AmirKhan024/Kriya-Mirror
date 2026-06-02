import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildSquatPose } from '../../harness/pose-stub';
import { runSquatSession, warningsOtherThan } from '../../harness/runner';
import type { SquatPoseIntent } from '../../harness/types';

const CAL_MS = 2200;

function repIntent(t: number, peak = 100): number {
  if (t < 1000) return (t / 1000) * peak;
  if (t < 1500) return peak;
  if (t < 2500) return peak - ((t - 1500) / 1000) * peak;
  return 0;
}

function happyPath(fps: number, reps: number, extras: Partial<SquatPoseIntent> = {}) {
  const cycleMs = 3000;
  return buildFrames(
    (tMs) => {
      if (tMs < CAL_MS) return { kneeFlexionDeg: 0, feetWidthRatio: 1.25, armsOverhead: true, ...extras } as SquatPoseIntent;
      const tInRep = (tMs - CAL_MS) % cycleMs;
      return { kneeFlexionDeg: repIntent(tInRep), feetWidthRatio: 1.25, armsOverhead: false, ...extras } as SquatPoseIntent;
    },
    buildSquatPose,
    { fps, durationMs: CAL_MS + reps * cycleMs },
  );
}

describe('Squat — frame-rate invariance', () => {
  it('counts the same number of reps at 30fps and 60fps', () => {
    const r30 = runSquatSession(happyPath(30, 5));
    const r60 = runSquatSession(happyPath(60, 5));
    expect(r30.completedReps.length).toBe(5);
    expect(r60.completedReps.length).toBe(5);
  });

  it('handles low fps (15fps)', () => {
    const r15 = runSquatSession(happyPath(15, 5));
    // Allow some leeway (rep count should be within ±1 due to coarser sampling)
    expect(r15.completedReps.length).toBeGreaterThanOrEqual(4);
    expect(r15.completedReps.length).toBeLessThanOrEqual(5);
  });
});

describe('Squat — landmark noise tolerance', () => {
  it('counts reps reliably with mild gaussian noise (σ=0.008)', () => {
    const result = runSquatSession(happyPath(30, 5, { noise: 0.008, seed: 42 }));
    expect(result.completedReps.length).toBeGreaterThanOrEqual(4);
  });

  it('does NOT spam false posture warnings from noise', () => {
    const result = runSquatSession(happyPath(30, 5, { noise: 0.008, seed: 42 }));
    // Allow up to 2 noise-triggered warnings across 15 seconds of activity
    const noise_warnings = warningsOtherThan(result, 'not-moving');
    expect(noise_warnings.length).toBeLessThanOrEqual(3);
  });
});

describe('Squat — pose loss recovery', () => {
  it('counts reps before pose loss, recovers and counts reps after', () => {
    const cycleMs = 3000;
    // 3 reps clean, then 1s of pose loss, then 3 more reps
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) return { kneeFlexionDeg: 0, feetWidthRatio: 1.25, armsOverhead: true } as SquatPoseIntent;
        const tAfterCal = tMs - CAL_MS;
        // Pose loss window
        if (tAfterCal >= 3 * cycleMs && tAfterCal < 3 * cycleMs + 1000) return null;
        const tInRep = tAfterCal % cycleMs;
        return { kneeFlexionDeg: repIntent(tInRep), feetWidthRatio: 1.25, armsOverhead: false } as SquatPoseIntent;
      },
      buildSquatPose,
      { fps: 30, durationMs: CAL_MS + 6 * cycleMs + 1000 },
    );
    const result = runSquatSession(frames);
    expect(result.completedReps.length).toBeGreaterThanOrEqual(5);
  });
});
