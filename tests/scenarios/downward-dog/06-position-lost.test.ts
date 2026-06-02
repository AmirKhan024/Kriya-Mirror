/**
 * Fix N — cross-cutting `position-lost` warning. If no usable pose frame
 * (landmarks null OR core body landmarks not visible) for ≥ 3 s post-calibration,
 * the engine emits `position-lost`, repeating at most every 10 s while lost.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildDownwardDogPose } from '../../harness/pose-stub';
import { runDownwardDogSession, countWarnings } from '../../harness/runner';
import type { DownwardDogPoseIntent } from '../../harness/types';

const CAL_MS = 1000;

describe('Downward Dog — position-lost (Fix N)', () => {
  it('fires position-lost after 3+ seconds of null landmarks post-calibration', () => {
    const frames = buildFrames(
      (tMs): DownwardDogPoseIntent | null =>
        tMs < CAL_MS ? { apexAngleDeg: 90, side: 'left' } : null,
      buildDownwardDogPose,
      { fps: 30, durationMs: CAL_MS + 4000 },
    );
    const result = runDownwardDogSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'position-lost')).toBeGreaterThan(0);
  });

  it('does NOT fire position-lost on a clean continuous stream', () => {
    const frames = buildFrames(
      (): DownwardDogPoseIntent => ({ apexAngleDeg: 90, side: 'left' }),
      buildDownwardDogPose,
      { fps: 30, durationMs: CAL_MS + 4000 },
    );
    const result = runDownwardDogSession(frames);
    expect(countWarnings(result, 'position-lost')).toBe(0);
  });

  it('does NOT re-fire position-lost within the 10s cooldown', () => {
    const frames = buildFrames(
      (tMs): DownwardDogPoseIntent | null =>
        tMs < CAL_MS ? { apexAngleDeg: 90, side: 'left' } : null,
      buildDownwardDogPose,
      { fps: 30, durationMs: CAL_MS + 5000 },
    );
    const result = runDownwardDogSession(frames);
    expect(countWarnings(result, 'position-lost')).toBe(1);
  });
});
