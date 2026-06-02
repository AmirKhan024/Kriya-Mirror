/**
 * Regression test for Fix I + Fix P on High Knees.
 *
 * Fix I: `bothDownSince = 0` at construction caused the first post-cal frame
 * to report `idleMs = (now - 0)` = millions, instantly firing 'not-moving'.
 * Fix initializes `bothDownSince = now` on cal-confirm.
 *
 * Fix P: cold-start cooldown lets the first idle warning fire even when the
 * engine timestamp is still small.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildHighKneesPose } from '../../harness/pose-stub';
import { runHighKneesSession, countWarnings } from '../../harness/runner';
import type { HighKneesPoseIntent } from '../../harness/types';

describe('High Knees — regression: no immediate "not-moving" after calibration', () => {
  it('does NOT fire not-moving within the first 3s after calibration confirms', () => {
    const frames = buildFrames(
      () => ({ leftKneeLiftPct: 0, rightKneeLiftPct: 0 } as HighKneesPoseIntent),
      buildHighKneesPose,
      { fps: 30, durationMs: 3200 },
    );

    const result = runHighKneesSession(frames);

    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThan(500);
    expect(countWarnings(result, 'not-moving')).toBe(0);
  });

  it('DOES fire not-moving after sustained idle past 5s post-calibration', () => {
    const frames = buildFrames(
      () => ({ leftKneeLiftPct: 0, rightKneeLiftPct: 0 } as HighKneesPoseIntent),
      buildHighKneesPose,
      { fps: 30, durationMs: 8500 },
    );

    const result = runHighKneesSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'not-moving')).toBeGreaterThan(0);
  });
});
