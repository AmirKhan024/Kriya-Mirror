/**
 * Robustness: a clean wall-sit hold must keep accumulating valid time under
 * MediaPipe-style jitter — small positional noise must not falsely freeze the
 * timer or break the hold (hysteresis + EMA absorb it).
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildWallSitPose } from '../../harness/pose-stub';
import { runWallSitSession, warningsOtherThan } from '../../harness/runner';
import type { WallSitPoseIntent } from '../../harness/types';

const CAL_MS = 2200;

describe('Wall Sit — noisy happy path', () => {
  it('accumulates a clean 20s hold under positional noise', () => {
    const frames = buildFrames(
      () => ({ kneeFlexionDeg: 90, trunkLeanDeg: 4, side: 'left' as const, noise: 0.003, seed: 9 } as WallSitPoseIntent),
      buildWallSitPose,
      { fps: 30, durationMs: CAL_MS + 20_000 },
    );
    const result = runWallSitSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.broken).toBe(false);
    expect(warningsOtherThan(result, 'not-moving').length).toBe(0);
    const lastTick = result.holdTicks[result.holdTicks.length - 1];
    // Most of the 20s should accumulate as valid hold time despite the jitter.
    expect(lastTick.secondsElapsed).toBeGreaterThanOrEqual(16);
  });
});
