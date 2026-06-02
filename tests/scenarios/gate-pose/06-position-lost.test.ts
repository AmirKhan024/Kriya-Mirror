/**
 * Fix N (cross-cutting `position-lost`): if no usable pose frame for ≥ 3 s
 * post-calibration, the engine emits `position-lost`, repeating at most every
 * 10 s while still lost.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildGatePosePose } from '../../harness/pose-stub';
import { runGatePoseSession, countWarnings } from '../../harness/runner';
import type { GatePosePoseIntent } from '../../harness/types';

const CAL_MS = 2200;

describe('Gate Pose — position-lost warning (Fix N)', () => {
  it('fires position-lost after 3+ seconds of null landmarks post-calibration', () => {
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) return { bendSide: 'right' as const } as GatePosePoseIntent;
        return null;
      },
      buildGatePosePose,
      { fps: 30, durationMs: CAL_MS + 4000 },
    );
    const result = runGatePoseSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'position-lost')).toBeGreaterThan(0);
  });

  it('does NOT fire position-lost on a clean continuous stream', () => {
    const frames = buildFrames(
      () => ({ bendSide: 'right' as const } as GatePosePoseIntent),
      buildGatePosePose,
      { fps: 30, durationMs: 4000 },
    );
    const result = runGatePoseSession(frames);
    expect(countWarnings(result, 'position-lost')).toBe(0);
  });

  it('does NOT re-fire position-lost within the 10s cooldown', () => {
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) return { bendSide: 'right' as const } as GatePosePoseIntent;
        return null;
      },
      buildGatePosePose,
      { fps: 30, durationMs: CAL_MS + 5000 },
    );
    const result = runGatePoseSession(frames);
    expect(countWarnings(result, 'position-lost')).toBe(1);
  });
});
