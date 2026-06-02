/**
 * Fix N — position-lost detection. If no usable pose frame for ≥ 3 s
 * post-calibration, the engine emits `position-lost`. Repeats every 10 s.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildBoatPosePose } from '../../harness/pose-stub';
import { runBoatPoseSession, countWarnings } from '../../harness/runner';
import type { BoatPosePoseIntent } from '../../harness/types';

const CAL_MS = 2200;

describe('Boat Pose — position-lost warning (Fix N)', () => {
  it('fires position-lost after 3+ seconds of null landmarks post-calibration', () => {
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) return { torsoAngleDeg: 45, legAngleDeg: 40 } as BoatPosePoseIntent;
        return null;
      },
      buildBoatPosePose,
      { fps: 30, durationMs: CAL_MS + 4000 },
    );
    const result = runBoatPoseSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'position-lost')).toBeGreaterThan(0);
  });

  it('does NOT fire position-lost on a clean continuous stream', () => {
    const frames = buildFrames(
      () => ({ torsoAngleDeg: 45, legAngleDeg: 40 } as BoatPosePoseIntent),
      buildBoatPosePose,
      { fps: 30, durationMs: 4000 },
    );
    const result = runBoatPoseSession(frames);
    expect(countWarnings(result, 'position-lost')).toBe(0);
  });

  it('does NOT re-fire position-lost within the 10s cooldown', () => {
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) return { torsoAngleDeg: 45, legAngleDeg: 40 } as BoatPosePoseIntent;
        return null;
      },
      buildBoatPosePose,
      { fps: 30, durationMs: CAL_MS + 5000 },
    );
    const result = runBoatPoseSession(frames);
    expect(countWarnings(result, 'position-lost')).toBe(1);
  });
});
