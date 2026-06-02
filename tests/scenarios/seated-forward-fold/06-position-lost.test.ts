/**
 * Fix N — cross-cutting `position-lost` warning. If no usable pose frame
 * (landmarks null OR core body landmarks not visible) for ≥ 3 s post-calibration,
 * the engine emits `position-lost`, repeating at most every 10 s while lost.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildSeatedForwardFoldPose } from '../../harness/pose-stub';
import { runSeatedForwardFoldSession, countWarnings } from '../../harness/runner';
import type { SeatedForwardFoldPoseIntent } from '../../harness/types';

const CAL_MS = 1000;

describe('Seated Forward Fold — position-lost (Fix N)', () => {
  it('fires position-lost after 3+ seconds of null landmarks post-calibration', () => {
    const frames = buildFrames(
      (tMs): SeatedForwardFoldPoseIntent | null =>
        tMs < CAL_MS ? { foldAngleDeg: 65, side: 'left' } : null,
      buildSeatedForwardFoldPose,
      { fps: 30, durationMs: CAL_MS + 4000 },
    );
    const result = runSeatedForwardFoldSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'position-lost')).toBeGreaterThan(0);
  });

  it('does NOT fire position-lost on a clean continuous stream', () => {
    const frames = buildFrames(
      (): SeatedForwardFoldPoseIntent => ({ foldAngleDeg: 65, side: 'left' }),
      buildSeatedForwardFoldPose,
      { fps: 30, durationMs: CAL_MS + 4000 },
    );
    const result = runSeatedForwardFoldSession(frames);
    expect(countWarnings(result, 'position-lost')).toBe(0);
  });

  it('does NOT re-fire position-lost within the 10s cooldown', () => {
    const frames = buildFrames(
      (tMs): SeatedForwardFoldPoseIntent | null =>
        tMs < CAL_MS ? { foldAngleDeg: 65, side: 'left' } : null,
      buildSeatedForwardFoldPose,
      { fps: 30, durationMs: CAL_MS + 5000 },
    );
    const result = runSeatedForwardFoldSession(frames);
    expect(countWarnings(result, 'position-lost')).toBe(1);
  });
});
