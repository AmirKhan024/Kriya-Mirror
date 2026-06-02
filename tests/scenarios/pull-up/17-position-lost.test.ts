/**
 * Fix N (round 6): position-lost detection.
 * After calibration, if no usable landmarks arrive for POSITION_LOST_TIMEOUT_MS (3s),
 * the engine fires a 'position-lost' warning. It repeats every 10s.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames, concatFrames } from '../../harness/frame-stream';
import { buildPullUpPose } from '../../harness/pose-stub';
import { runPullUpSession, countWarnings } from '../../harness/runner';
import type { PullUpPoseIntent } from '../../harness/types';

const CAL_MS = 2200;

describe('Pull-Up — position-lost detection (Fix N)', () => {
  it('fires position-lost after 3s of null landmarks post-calibration', () => {
    const calFrames = buildFrames(
      () => ({ elbowFlexionDeg: 0 } as PullUpPoseIntent),
      buildPullUpPose,
      { fps: 30, durationMs: CAL_MS },
    );
    // 4 seconds of null landmarks after calibration
    const nullFrames = buildFrames(
      () => null,
      buildPullUpPose,
      { fps: 30, durationMs: 4000 },
    );
    const frames = concatFrames(calFrames, nullFrames);
    const result = runPullUpSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'position-lost')).toBeGreaterThan(0);
  });

  it('does NOT fire position-lost within the 3s grace window', () => {
    const calFrames = buildFrames(
      () => ({ elbowFlexionDeg: 0 } as PullUpPoseIntent),
      buildPullUpPose,
      { fps: 30, durationMs: CAL_MS },
    );
    // Only 2 seconds of null — under the 3s threshold
    const nullFrames = buildFrames(
      () => null,
      buildPullUpPose,
      { fps: 30, durationMs: 2000 },
    );
    const frames = concatFrames(calFrames, nullFrames);
    const result = runPullUpSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'position-lost')).toBe(0);
  });
});
