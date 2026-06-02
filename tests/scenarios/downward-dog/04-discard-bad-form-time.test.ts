/**
 * Fix B + Fix U: a sustained hip-sag FREEZES the hold counter (valid time is
 * discarded, not wall-clock) and the longest-unfrozen streak tracks the longest
 * clean run rather than total valid time.
 *
 * Timeline: clean V 8s → hips drop (freeze) 5s → clean V again 5s.
 *   - total valid hold ≈ 13s (the 5s sag stretch is discarded)
 *   - longest streak ≈ 8s (the first clean run; the >1s freeze ends the streak)
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildDownwardDogPose } from '../../harness/pose-stub';
import { runDownwardDogSession } from '../../harness/runner';
import type { DownwardDogPoseIntent } from '../../harness/types';

const CAL_MS = 1000;

describe('Downward Dog — discard bad-form time (Fix B + Fix U)', () => {
  it('freezes the counter while the hips sag and tracks the longest streak', () => {
    const frames = buildFrames(
      (tMs): DownwardDogPoseIntent => {
        if (tMs < CAL_MS) return { apexAngleDeg: 90, side: 'left' };
        const t = tMs - CAL_MS;
        if (t < 8000) return { apexAngleDeg: 90, side: 'left' };    // clean 8s
        if (t < 13_000) return { apexAngleDeg: 135, side: 'left' }; // hips sag (freeze) 5s
        return { apexAngleDeg: 90, side: 'left' };                  // clean 5s
      },
      buildDownwardDogPose,
      { fps: 30, durationMs: CAL_MS + 18_000 },
    );
    const result = runDownwardDogSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.broken).toBe(false);

    const lastTick = result.holdTicks[result.holdTicks.length - 1];
    expect(lastTick.secondsElapsed).toBeGreaterThanOrEqual(11);
    expect(lastTick.secondsElapsed).toBeLessThanOrEqual(15);
    expect(lastTick.longestUnfrozenSec).toBeGreaterThanOrEqual(6);
    expect(lastTick.longestUnfrozenSec).toBeLessThan(lastTick.secondsElapsed);
  });
});
