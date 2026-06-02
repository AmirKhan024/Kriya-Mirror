import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildLungePose } from '../../harness/pose-stub';
import { runWalkingLungeSession, warningsOtherThan } from '../../harness/runner';
import type { LungePoseIntent } from '../../harness/types';

const CAL_MS = 2200;

function repFlex(t: number, peak = 90): number {
  if (t < 1000) return (t / 1000) * peak;
  if (t < 1500) return peak;
  if (t < 2500) return peak - ((t - 1500) / 1000) * peak;
  return 0;
}

function happyPath(fps: number, reps: number, extras: Partial<LungePoseIntent> = {}) {
  const cycleMs = 3000;
  return buildFrames(
    (tMs) => {
      if (tMs < CAL_MS) {
        return { kneeFlexionDeg: 0, frontLeg: 'left' as const, armsAtSides: true, ...extras } as LungePoseIntent;
      }
      const repIndex = Math.floor((tMs - CAL_MS) / cycleMs);
      const tInRep = (tMs - CAL_MS) % cycleMs;
      return {
        kneeFlexionDeg: repFlex(tInRep),
        frontLeg: (repIndex % 2 === 0 ? 'left' : 'right') as 'left' | 'right',
        armsAtSides: false,
        ...extras,
      } as LungePoseIntent;
    },
    buildLungePose,
    { fps, durationMs: CAL_MS + reps * cycleMs },
  );
}

describe('Walking Lunge — frame-rate invariance', () => {
  it('counts the same number of steps at 30fps and 60fps', () => {
    const r30 = runWalkingLungeSession(happyPath(30, 4));
    const r60 = runWalkingLungeSession(happyPath(60, 4));
    expect(r30.completedReps.length).toBe(4);
    expect(r60.completedReps.length).toBe(4);
  });

  it('handles low fps (15fps)', () => {
    const r15 = runWalkingLungeSession(happyPath(15, 4));
    expect(r15.completedReps.length).toBeGreaterThanOrEqual(3);
    expect(r15.completedReps.length).toBeLessThanOrEqual(4);
  });
});

describe('Walking Lunge — landmark noise tolerance', () => {
  it('counts steps reliably with mild gaussian noise (σ=0.006)', () => {
    const result = runWalkingLungeSession(happyPath(30, 4, { noise: 0.006, seed: 11 }));
    expect(result.completedReps.length).toBeGreaterThanOrEqual(3);
  });

  it('does NOT spam false posture warnings from noise', () => {
    const result = runWalkingLungeSession(happyPath(30, 4, { noise: 0.006, seed: 11 }));
    const noiseWarnings = warningsOtherThan(result, 'not-moving');
    expect(noiseWarnings.length).toBeLessThanOrEqual(3);
  });
});

describe('Walking Lunge — pose loss recovery', () => {
  it('recovers and continues counting steps after a 1-second pose dropout', () => {
    const cycleMs = 3000;
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) return { kneeFlexionDeg: 0, frontLeg: 'left' as const, armsAtSides: true } as LungePoseIntent;
        const tAfterCal = tMs - CAL_MS;
        if (tAfterCal >= 2 * cycleMs && tAfterCal < 2 * cycleMs + 1000) return null;
        const repIndex = Math.floor(tAfterCal / cycleMs);
        const tInRep = tAfterCal % cycleMs;
        return {
          kneeFlexionDeg: repFlex(tInRep),
          frontLeg: (repIndex % 2 === 0 ? 'left' : 'right') as 'left' | 'right',
          armsAtSides: false,
        } as LungePoseIntent;
      },
      buildLungePose,
      { fps: 30, durationMs: CAL_MS + 5 * cycleMs + 1000 },
    );
    const result = runWalkingLungeSession(frames);
    expect(result.completedReps.length).toBeGreaterThanOrEqual(3);
  });
});
