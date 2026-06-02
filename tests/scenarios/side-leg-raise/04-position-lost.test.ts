/**
 * Fix N — position-lost detection. No usable pose frame for ≥ 3s post-cal →
 * `position-lost`, repeating at most every 10s while still lost.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildSideLegRaisePose } from '../../harness/pose-stub';
import { runSideLegRaiseSession, countWarnings } from '../../harness/runner';
import type { SideLegRaisePoseIntent } from '../../harness/types';

const CAL_MS = 2200;

describe('Side Leg Raise — position-lost warning (Fix N)', () => {
  it('fires position-lost after 3+ seconds of null landmarks post-calibration', () => {
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) return { leftAbductionDeg: 0, rightAbductionDeg: 0 } as SideLegRaisePoseIntent;
        return null;
      },
      buildSideLegRaisePose,
      { fps: 30, durationMs: CAL_MS + 4000 },
    );
    const result = runSideLegRaiseSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'position-lost')).toBeGreaterThan(0);
  });

  it('does NOT fire position-lost on a clean continuous standing stream', () => {
    const frames = buildFrames(
      () => ({ leftAbductionDeg: 0, rightAbductionDeg: 0 } as SideLegRaisePoseIntent),
      buildSideLegRaisePose,
      { fps: 30, durationMs: 4000 },
    );
    const result = runSideLegRaiseSession(frames);
    expect(countWarnings(result, 'position-lost')).toBe(0);
  });

  it('does NOT re-fire position-lost within the 10s cooldown', () => {
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) return { leftAbductionDeg: 0, rightAbductionDeg: 0 } as SideLegRaisePoseIntent;
        return null;
      },
      buildSideLegRaisePose,
      { fps: 30, durationMs: CAL_MS + 5000 },
    );
    const result = runSideLegRaiseSession(frames);
    expect(countWarnings(result, 'position-lost')).toBe(1);
  });
});
