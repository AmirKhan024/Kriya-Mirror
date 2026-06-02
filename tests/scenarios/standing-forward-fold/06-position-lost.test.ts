/**
 * Fix N — cross-cutting `position-lost` warning. If no usable pose frame
 * (landmarks null OR core body landmarks not visible) for ≥ 3 s post-calibration,
 * the engine emits `position-lost`, repeating at most every 10 s while lost.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildForwardFoldPose } from '../../harness/pose-stub';
import { runStandingForwardFoldSession, countWarnings } from '../../harness/runner';
import type { ForwardFoldPoseIntent } from '../../harness/types';

const CAL_MS = 1000;

describe('Standing Forward Fold — position-lost (Fix N)', () => {
  it('fires position-lost after 3+ seconds of null landmarks post-calibration', () => {
    const frames = buildFrames(
      (tMs): ForwardFoldPoseIntent | null =>
        tMs < CAL_MS ? { foldAngleDeg: 75, side: 'left' } : null,
      buildForwardFoldPose,
      { fps: 30, durationMs: CAL_MS + 4000 },
    );
    const result = runStandingForwardFoldSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'position-lost')).toBeGreaterThan(0);
  });

  it('does NOT fire position-lost on a clean continuous stream', () => {
    const frames = buildFrames(
      (): ForwardFoldPoseIntent => ({ foldAngleDeg: 75, side: 'left' }),
      buildForwardFoldPose,
      { fps: 30, durationMs: CAL_MS + 4000 },
    );
    const result = runStandingForwardFoldSession(frames);
    expect(countWarnings(result, 'position-lost')).toBe(0);
  });

  it('does NOT re-fire position-lost within the 10s cooldown', () => {
    const frames = buildFrames(
      (tMs): ForwardFoldPoseIntent | null =>
        tMs < CAL_MS ? { foldAngleDeg: 75, side: 'left' } : null,
      buildForwardFoldPose,
      { fps: 30, durationMs: CAL_MS + 5000 },
    );
    const result = runStandingForwardFoldSession(frames);
    expect(countWarnings(result, 'position-lost')).toBe(1);
  });
});
