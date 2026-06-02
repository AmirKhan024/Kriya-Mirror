/**
 * Hold-broken: the ONLY terminal condition is sitting fully back up (torso fold
 * angle below STAND_BROKEN = 25). A shallower come-up is recoverable and only
 * freezes the timer.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildSeatedForwardFoldPose } from '../../harness/pose-stub';
import { runSeatedForwardFoldSession } from '../../harness/runner';
import type { SeatedForwardFoldPoseIntent } from '../../harness/types';

const CAL_MS = 1000;

describe('Seated Forward Fold — hold broken', () => {
  it('ends the hold when the user sits fully back up', () => {
    const frames = buildFrames(
      (tMs): SeatedForwardFoldPoseIntent => tMs < CAL_MS
        ? { foldAngleDeg: 65, side: 'left' }
        : { foldAngleDeg: 3, side: 'left' },
      buildSeatedForwardFoldPose,
      { fps: 30, durationMs: CAL_MS + 3000 },
    );
    const result = runSeatedForwardFoldSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.broken).toBe(true);
  });

  it('does NOT end the hold while the user stays folded', () => {
    const frames = buildFrames(
      (): SeatedForwardFoldPoseIntent => ({ foldAngleDeg: 65, side: 'left' }),
      buildSeatedForwardFoldPose,
      { fps: 30, durationMs: CAL_MS + 8000 },
    );
    const result = runSeatedForwardFoldSession(frames);
    expect(result.broken).toBe(false);
  });
});
