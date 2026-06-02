/**
 * Fix N — position-lost detection. If no usable pose frame for ≥ 3 s
 * post-calibration, the engine emits `position-lost`. Repeats at most every
 * 10 s while still lost.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildMountainPosePose } from '../../harness/pose-stub';
import { runMountainPoseSession, countWarnings } from '../../harness/runner';
import type { MountainPosePoseIntent } from '../../harness/types';

const CAL_MS = 2200;

describe('Mountain Pose — position-lost warning (Fix N)', () => {
  it('fires position-lost after 3+ seconds of null landmarks post-cal', () => {
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) return {} as MountainPosePoseIntent;
        return null;
      },
      buildMountainPosePose,
      { fps: 30, durationMs: CAL_MS + 4000 },
    );
    const result = runMountainPoseSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'position-lost')).toBeGreaterThan(0);
  });

  it('does NOT fire position-lost on a clean continuous stream', () => {
    const frames = buildFrames(
      () => ({} as MountainPosePoseIntent),
      buildMountainPosePose,
      { fps: 30, durationMs: 4000 },
    );
    const result = runMountainPoseSession(frames);
    expect(countWarnings(result, 'position-lost')).toBe(0);
  });

  it('does NOT fire position-lost during the brief calibration phase', () => {
    const frames = buildFrames(
      (tMs) => {
        if (tMs < 1500) return null;
        return {} as MountainPosePoseIntent;
      },
      buildMountainPosePose,
      { fps: 30, durationMs: 3000 },
    );
    const result = runMountainPoseSession(frames);
    expect(countWarnings(result, 'position-lost')).toBe(0);
  });

  it('does NOT re-fire position-lost within the 10s cooldown', () => {
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) return {} as MountainPosePoseIntent;
        return null;
      },
      buildMountainPosePose,
      { fps: 30, durationMs: CAL_MS + 5000 },
    );
    const result = runMountainPoseSession(frames);
    expect(countWarnings(result, 'position-lost')).toBe(1);
  });
});
