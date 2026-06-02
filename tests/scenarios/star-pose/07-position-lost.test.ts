/**
 * Fix N (cross-cutting `position-lost`) for Star Pose. Mirrors the single-leg-
 * stand position-lost test: if no usable pose frame (null landmarks OR core
 * body landmarks not visible) for ≥ 3 s post-calibration, the engine emits
 * `position-lost`, repeating at most every 10 s while still lost.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildStarPosePose } from '../../harness/pose-stub';
import { runStarPoseSession, countWarnings } from '../../harness/runner';
import type { StarPosePoseIntent } from '../../harness/types';

const CAL_MS = 2200;

describe('Star Pose — position-lost warning (Fix N)', () => {
  it('fires position-lost after 3+ seconds of null landmarks post-calibration', () => {
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) return { liftedSide: 'left' as const } as StarPosePoseIntent;
        return null;
      },
      buildStarPosePose,
      { fps: 30, durationMs: CAL_MS + 4000 },
    );
    const result = runStarPoseSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'position-lost')).toBeGreaterThan(0);
  });

  it('does NOT fire position-lost on a clean continuous stream', () => {
    const frames = buildFrames(
      () => ({ liftedSide: 'left' as const } as StarPosePoseIntent),
      buildStarPosePose,
      { fps: 30, durationMs: 4000 },
    );
    const result = runStarPoseSession(frames);
    expect(countWarnings(result, 'position-lost')).toBe(0);
  });

  it('does NOT fire position-lost during the brief calibration phase', () => {
    const frames = buildFrames(
      (tMs) => {
        if (tMs < 1500) return null;
        return { liftedSide: 'left' as const } as StarPosePoseIntent;
      },
      buildStarPosePose,
      { fps: 30, durationMs: 3000 },
    );
    const result = runStarPoseSession(frames);
    expect(countWarnings(result, 'position-lost')).toBe(0);
  });

  it('does NOT re-fire position-lost within the 10s cooldown', () => {
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) return { liftedSide: 'left' as const } as StarPosePoseIntent;
        return null;
      },
      buildStarPosePose,
      { fps: 30, durationMs: CAL_MS + 5000 },
    );
    const result = runStarPoseSession(frames);
    expect(countWarnings(result, 'position-lost')).toBe(1);
  });
});
