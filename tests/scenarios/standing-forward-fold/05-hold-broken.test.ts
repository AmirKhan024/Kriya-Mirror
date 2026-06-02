/**
 * Hold-broken: the ONLY terminal condition is the user standing fully back up
 * (fold angle returns toward vertical, below STAND_BROKEN_DEG = 30). Every other
 * form-break is recoverable and only freezes the timer.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildForwardFoldPose } from '../../harness/pose-stub';
import { runStandingForwardFoldSession } from '../../harness/runner';
import type { ForwardFoldPoseIntent } from '../../harness/types';

const CAL_MS = 1000;

describe('Standing Forward Fold — hold broken', () => {
  it('ends the hold when the user stands fully back up', () => {
    const frames = buildFrames(
      (tMs): ForwardFoldPoseIntent => tMs < CAL_MS
        ? { foldAngleDeg: 75, side: 'left' }
        : { foldAngleDeg: 12, side: 'left' },
      buildForwardFoldPose,
      { fps: 30, durationMs: CAL_MS + 3000 },
    );
    const result = runStandingForwardFoldSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.broken).toBe(true);
  });

  it('does NOT end the hold while the user stays folded', () => {
    const frames = buildFrames(
      (): ForwardFoldPoseIntent => ({ foldAngleDeg: 75, side: 'left' }),
      buildForwardFoldPose,
      { fps: 30, durationMs: CAL_MS + 8000 },
    );
    const result = runStandingForwardFoldSession(frames);
    expect(result.broken).toBe(false);
  });
});
