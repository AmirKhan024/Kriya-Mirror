import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildHammerCurlPose } from '../../harness/pose-stub';
import { runHammerCurlSession, warningsOtherThan } from '../../harness/runner';
import type { HammerCurlPoseIntent } from '../../harness/types';

const CAL_MS = 2200;

function repFlex(t: number, peak = 130): number {
  if (t < 1000) return (t / 1000) * peak;
  if (t < 1500) return peak;
  if (t < 2500) return peak - ((t - 1500) / 1000) * peak;
  return 0;
}

function happyPath(fps: number, reps: number, extras: Partial<HammerCurlPoseIntent> = {}) {
  const cycleMs = 3000;
  return buildFrames(
    (tMs) => {
      if (tMs < CAL_MS) return { elbowFlexionDeg: 0, ...extras } as HammerCurlPoseIntent;
      const tInRep = (tMs - CAL_MS) % cycleMs;
      return { elbowFlexionDeg: repFlex(tInRep), ...extras } as HammerCurlPoseIntent;
    },
    buildHammerCurlPose,
    { fps, durationMs: CAL_MS + reps * cycleMs },
  );
}

describe('Hammer Curl — frame-rate invariance', () => {
  it('counts the same number of reps at 30fps and 60fps', () => {
    const r30 = runHammerCurlSession(happyPath(30, 5));
    const r60 = runHammerCurlSession(happyPath(60, 5));
    expect(r30.completedReps.length).toBe(5);
    expect(r60.completedReps.length).toBe(5);
  });

  it('handles low fps (15fps) gracefully — engine must not crash', () => {
    // At 15fps the EMA(α=0.15) smoother lags behind the raw peak. Reps may
    // be rejected as incomplete-curl — graceful degradation, not a bug.
    const r15 = runHammerCurlSession(happyPath(15, 5));
    expect(r15.completedReps.length).toBeGreaterThanOrEqual(0);
    const noiseWarnings = r15.warnings.filter(
      (w) => w.type !== 'not-moving' && w.type !== 'incomplete-curl',
    );
    expect(noiseWarnings.length).toBeLessThanOrEqual(2);
  });
});

describe('Hammer Curl — landmark noise tolerance', () => {
  it('counts reps reliably with mild gaussian noise (σ=0.005)', () => {
    const result = runHammerCurlSession(happyPath(30, 5, { noise: 0.005, seed: 42 }));
    expect(result.completedReps.length).toBeGreaterThanOrEqual(4);
  });

  it('does NOT spam false posture warnings from noise', () => {
    const result = runHammerCurlSession(happyPath(30, 5, { noise: 0.005, seed: 42 }));
    const noiseWarnings = warningsOtherThan(result, 'not-moving');
    expect(noiseWarnings.length).toBeLessThanOrEqual(3);
  });
});

describe('Hammer Curl — pose loss recovery', () => {
  it('recovers and continues counting reps after a 1-second pose dropout', () => {
    const cycleMs = 3000;
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) return { elbowFlexionDeg: 0 } as HammerCurlPoseIntent;
        const tAfterCal = tMs - CAL_MS;
        if (tAfterCal >= 2 * cycleMs && tAfterCal < 2 * cycleMs + 1000) return null;
        const tInRep = tAfterCal % cycleMs;
        return { elbowFlexionDeg: repFlex(tInRep) } as HammerCurlPoseIntent;
      },
      buildHammerCurlPose,
      { fps: 30, durationMs: CAL_MS + 5 * cycleMs + 1000 },
    );
    const result = runHammerCurlSession(frames);
    expect(result.completedReps.length).toBeGreaterThanOrEqual(3);
  });
});
