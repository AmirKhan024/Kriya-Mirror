/**
 * Fix B + Fix U: a sustained recoverable form-break FREEZES the hold counter
 * (valid time is discarded, not wall-clock) and the longest-unfrozen streak
 * tracks the longest clean run rather than total valid time.
 *
 * Timeline: clean fold 8s → come up shallow (freeze) 5s → clean fold again 5s.
 *   - total valid hold ≈ 13s (the 5s shallow stretch is discarded)
 *   - longest streak ≈ 8s (the first clean run; the >1s freeze ends the streak)
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildForwardFoldPose } from '../../harness/pose-stub';
import { runStandingForwardFoldSession } from '../../harness/runner';
import type { ForwardFoldPoseIntent } from '../../harness/types';

const CAL_MS = 1000;

describe('Standing Forward Fold — discard bad-form time (Fix B + Fix U)', () => {
  it('freezes the counter during a shallow stretch and tracks the longest streak', () => {
    const frames = buildFrames(
      (tMs): ForwardFoldPoseIntent => {
        if (tMs < CAL_MS) return { foldAngleDeg: 75, side: 'left' };
        const t = tMs - CAL_MS;
        if (t < 8000) return { foldAngleDeg: 75, side: 'left' };   // clean 8s
        if (t < 13_000) return { foldAngleDeg: 40, side: 'left' }; // shallow (freeze) 5s
        return { foldAngleDeg: 75, side: 'left' };                 // clean 5s
      },
      buildForwardFoldPose,
      { fps: 30, durationMs: CAL_MS + 18_000 },
    );
    const result = runStandingForwardFoldSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.broken).toBe(false);

    const lastTick = result.holdTicks[result.holdTicks.length - 1];
    // Wall-clock post-cal is ~18s, but the 5s shallow stretch is discarded → ~13s valid.
    expect(lastTick.secondsElapsed).toBeGreaterThanOrEqual(11);
    expect(lastTick.secondsElapsed).toBeLessThanOrEqual(15);
    // Longest clean run is the first ~8s; the >1s freeze ends that streak.
    expect(lastTick.longestUnfrozenSec).toBeGreaterThanOrEqual(6);
    expect(lastTick.longestUnfrozenSec).toBeLessThan(lastTick.secondsElapsed);
  });
});
