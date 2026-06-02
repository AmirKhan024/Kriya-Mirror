import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildPlankPose } from '../../harness/pose-stub';
import { runPlankSession, warningsOtherThan } from '../../harness/runner';

const CAL_MS = 2200;

describe('Plank — noise tolerance', () => {
  it('does NOT fire false warnings with mild gaussian noise (σ=0.006)', () => {
    const frames = buildFrames(
      () => ({ hipDelta: 0, side: 'left' as const, noise: 0.006, seed: 7 }),
      buildPlankPose,
      { fps: 30, durationMs: CAL_MS + 10_000 },
    );
    const result = runPlankSession(frames);
    // EMA smoothing should suppress noise — allow at most 1 false warning
    expect(warningsOtherThan(result).length).toBeLessThanOrEqual(1);
  });
});

describe('Plank — pose loss', () => {
  it('engine survives null landmarks mid-hold', () => {
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) return { hipDelta: 0, side: 'left' as const };
        // Pose loss for 500ms starting at 4s post-calibration
        const tAfter = tMs - CAL_MS;
        if (tAfter >= 4000 && tAfter < 4500) return null;
        return { hipDelta: 0, side: 'left' as const };
      },
      buildPlankPose,
      { fps: 30, durationMs: CAL_MS + 10_000 },
    );
    const result = runPlankSession(frames);
    // The engine should have continued ticking before and after the loss
    expect(result.holdTicks.length).toBeGreaterThanOrEqual(8);
    expect(result.broken).toBe(false);
  });
});

describe('Plank — form score reflects mix', () => {
  it('average MQS drops when a sag period is included', () => {
    const cleanFrames = buildFrames(
      () => ({ hipDelta: 0, side: 'left' as const }),
      buildPlankPose,
      { fps: 30, durationMs: CAL_MS + 10_000 },
    );
    const cleanResult = runPlankSession(cleanFrames);
    const cleanAvg =
      cleanResult.holdTicks.reduce((s, t) => s + t.mqs, 0) / cleanResult.holdTicks.length;

    const sagFrames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) return { hipDelta: 0, side: 'left' as const };
        const tAfter = tMs - CAL_MS;
        // First 3s clean, next 4s sagging, last 3s clean
        if (tAfter >= 3000 && tAfter < 7000) return { hipDelta: 0.08, side: 'left' as const };
        return { hipDelta: 0, side: 'left' as const };
      },
      buildPlankPose,
      { fps: 30, durationMs: CAL_MS + 10_000 },
    );
    const sagResult = runPlankSession(sagFrames);
    const sagAvg =
      sagResult.holdTicks.reduce((s, t) => s + t.mqs, 0) / sagResult.holdTicks.length;

    expect(sagAvg).toBeLessThan(cleanAvg);
  });
});
