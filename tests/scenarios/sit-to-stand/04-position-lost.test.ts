/**
 * Fix N — position-lost detection. No usable pose frame for ≥ 3s post-cal →
 * `position-lost`, repeating at most every 10s while still lost.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildChairPosePose } from '../../harness/pose-stub';
import { runSitToStandSession, countWarnings } from '../../harness/runner';
import type { ChairPosePoseIntent } from '../../harness/types';

const CAL_MS = 2200;

describe('Sit-to-Stand — position-lost warning (Fix N)', () => {
  it('fires position-lost after 3+ seconds of null landmarks post-calibration', () => {
    const frames = buildFrames(
      (tMs) => (tMs < CAL_MS ? ({ kneeFlexionDeg: 90, side: 'left' } as ChairPosePoseIntent) : null),
      buildChairPosePose,
      { fps: 30, durationMs: CAL_MS + 4000 },
    );
    const result = runSitToStandSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'position-lost')).toBeGreaterThan(0);
  });

  it('does NOT re-fire position-lost within the 10s cooldown', () => {
    const frames = buildFrames(
      (tMs) => (tMs < CAL_MS ? ({ kneeFlexionDeg: 90, side: 'left' } as ChairPosePoseIntent) : null),
      buildChairPosePose,
      { fps: 30, durationMs: CAL_MS + 5000 },
    );
    const result = runSitToStandSession(frames);
    expect(countWarnings(result, 'position-lost')).toBe(1);
  });
});
