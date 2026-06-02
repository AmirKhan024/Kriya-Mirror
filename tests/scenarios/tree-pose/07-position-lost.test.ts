/**
 * Fix N — position-lost detection. If no usable pose frame for ≥ 3s
 * post-calibration, the engine emits `position-lost`. Repeats at most every
 * 10s while still lost.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildTreePosePose } from '../../harness/pose-stub';
import { runTreePoseSession, countWarnings } from '../../harness/runner';
import type { TreePosePoseIntent } from '../../harness/types';

const CAL_MS = 2200;

describe('Tree Pose — position-lost warning (Fix N)', () => {
  it('fires position-lost after 3+ seconds of null landmarks post-calibration', () => {
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) return { liftedSide: 'left' as const } as TreePosePoseIntent;
        return null;
      },
      buildTreePosePose,
      { fps: 30, durationMs: CAL_MS + 4000 },
    );
    const result = runTreePoseSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'position-lost')).toBeGreaterThan(0);
  });

  it('does NOT fire position-lost on a clean continuous stream', () => {
    const frames = buildFrames(
      () => ({ liftedSide: 'left' as const } as TreePosePoseIntent),
      buildTreePosePose,
      { fps: 30, durationMs: 4000 },
    );
    const result = runTreePoseSession(frames);
    expect(countWarnings(result, 'position-lost')).toBe(0);
  });

  it('does NOT fire position-lost during the brief calibration phase', () => {
    const frames = buildFrames(
      (tMs) => {
        if (tMs < 1500) return null;
        return { liftedSide: 'left' as const } as TreePosePoseIntent;
      },
      buildTreePosePose,
      { fps: 30, durationMs: 3000 },
    );
    const result = runTreePoseSession(frames);
    expect(countWarnings(result, 'position-lost')).toBe(0);
  });

  it('does NOT re-fire position-lost within the 10s cooldown', () => {
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) return { liftedSide: 'left' as const } as TreePosePoseIntent;
        return null;
      },
      buildTreePosePose,
      { fps: 30, durationMs: CAL_MS + 5000 },
    );
    const result = runTreePoseSession(frames);
    expect(countWarnings(result, 'position-lost')).toBe(1);
  });
});
