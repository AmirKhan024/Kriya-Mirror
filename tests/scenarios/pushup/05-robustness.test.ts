import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildPushupPose } from '../../harness/pose-stub';
import { runPushupSession, warningsOtherThan } from '../../harness/runner';
import type { PushupPoseIntent } from '../../harness/types';

const CAL_MS = 2200;

function repFlex(t: number, peak = 90): number {
  if (t < 1000) return (t / 1000) * peak;
  if (t < 1500) return peak;
  if (t < 2500) return peak - ((t - 1500) / 1000) * peak;
  return 0;
}

function happyPath(fps: number, reps: number, extras: Partial<PushupPoseIntent> = {}) {
  const cycleMs = 3000;
  return buildFrames(
    (tMs) => {
      if (tMs < CAL_MS) return { elbowFlexionDeg: 0, side: 'left' as const, ...extras } as PushupPoseIntent;
      const tInRep = (tMs - CAL_MS) % cycleMs;
      return { elbowFlexionDeg: repFlex(tInRep), side: 'left' as const, ...extras } as PushupPoseIntent;
    },
    buildPushupPose,
    { fps, durationMs: CAL_MS + reps * cycleMs },
  );
}

describe('Push-Up — frame-rate invariance', () => {
  it('counts the same number of reps at 30fps and 60fps', () => {
    const r30 = runPushupSession(happyPath(30, 5));
    const r60 = runPushupSession(happyPath(60, 5));
    expect(r30.completedReps.length).toBe(5);
    expect(r60.completedReps.length).toBe(5);
  });

  it('handles low fps (15fps)', () => {
    const r15 = runPushupSession(happyPath(15, 5));
    expect(r15.completedReps.length).toBeGreaterThanOrEqual(4);
    expect(r15.completedReps.length).toBeLessThanOrEqual(5);
  });
});

describe('Push-Up — landmark noise tolerance', () => {
  it('counts reps reliably with mild gaussian noise (σ=0.006)', () => {
    const result = runPushupSession(happyPath(30, 5, { noise: 0.006, seed: 17 }));
    expect(result.completedReps.length).toBeGreaterThanOrEqual(4);
  });

  it('does NOT spam false posture warnings from noise', () => {
    const result = runPushupSession(happyPath(30, 5, { noise: 0.006, seed: 17 }));
    const noiseWarnings = warningsOtherThan(result, 'not-moving');
    expect(noiseWarnings.length).toBeLessThanOrEqual(3);
  });
});

describe('Push-Up — pose loss recovery', () => {
  it('recovers and continues counting reps after a 1-second pose dropout', () => {
    const cycleMs = 3000;
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) return { elbowFlexionDeg: 0, side: 'left' as const } as PushupPoseIntent;
        const tAfterCal = tMs - CAL_MS;
        if (tAfterCal >= 3 * cycleMs && tAfterCal < 3 * cycleMs + 1000) return null;
        const tInRep = tAfterCal % cycleMs;
        return { elbowFlexionDeg: repFlex(tInRep), side: 'left' as const } as PushupPoseIntent;
      },
      buildPushupPose,
      { fps: 30, durationMs: CAL_MS + 6 * cycleMs + 1000 },
    );
    const result = runPushupSession(frames);
    expect(result.completedReps.length).toBeGreaterThanOrEqual(5);
  });
});
