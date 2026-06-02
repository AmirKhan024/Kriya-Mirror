/**
 * Kettlebell Swing — position-lost warning (Fix N).
 * If no usable pose frame for ≥ 3 seconds post-calibration, fires position-lost.
 * Repeats at most every 10s while still lost.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildKBSwingPose } from '../../harness/pose-stub';
import { runKBSwingSession, countWarnings } from '../../harness/runner';
import type { KBSwingPoseIntent } from '../../harness/types';

const CAL_MS = 1000;

describe('Kettlebell Swing — position-lost warning (Fix N)', () => {
  it('fires position-lost after 3+ seconds of null landmarks post-calibration', () => {
    const frames = buildFrames(
      (tMs): KBSwingPoseIntent | null => {
        if (tMs < CAL_MS) return { hipHingeDeg: 0 };
        return null;  // user stepped out of frame
      },
      buildKBSwingPose,
      { fps: 30, durationMs: CAL_MS + 4000 },
    );

    const result = runKBSwingSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'position-lost')).toBeGreaterThan(0);
  });

  it('does NOT fire position-lost on a clean continuous stream', () => {
    const frames = buildFrames(
      (): KBSwingPoseIntent => ({ hipHingeDeg: 0 }),
      buildKBSwingPose,
      { fps: 30, durationMs: 5000 },
    );

    const result = runKBSwingSession(frames);
    expect(countWarnings(result, 'position-lost')).toBe(0);
  });

  it('does NOT fire position-lost during the calibration phase', () => {
    // Null during calibration — engine not yet confirmed, should not fire
    const frames = buildFrames(
      (tMs): KBSwingPoseIntent | null => {
        if (tMs < 1500) return null;
        return { hipHingeDeg: 0 };
      },
      buildKBSwingPose,
      { fps: 30, durationMs: 3000 },
    );

    const result = runKBSwingSession(frames);
    expect(countWarnings(result, 'position-lost')).toBe(0);
  });

  it('does NOT re-fire position-lost within the 10s cooldown', () => {
    // 5 seconds of null post-cal — should fire exactly once (at the 3s mark)
    const frames = buildFrames(
      (tMs): KBSwingPoseIntent | null => {
        if (tMs < CAL_MS) return { hipHingeDeg: 0 };
        return null;
      },
      buildKBSwingPose,
      { fps: 30, durationMs: CAL_MS + 5000 },
    );

    const result = runKBSwingSession(frames);
    expect(countWarnings(result, 'position-lost')).toBe(1);
  });
});
