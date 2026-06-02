/**
 * Fix I (init-on-cal-confirm) + Fix P (cold-start cooldown sentinel).
 *
 * `downSince = 0` at construction would cause the first post-cal frame to
 * report idleMs = (now - 0) = millions, instantly firing 'not-moving'. Fix I
 * seeds `downSince = now` on cal-confirm. Fix P treats `lastNoMovementWarnAt
 * === 0` as "never fired" so the first idle warning isn't suppressed by the
 * 15 s repeat cooldown when engine timestamps are still small.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildLateralRaisePose } from '../../harness/pose-stub';
import { runLateralRaiseSession, countWarnings } from '../../harness/runner';
import type { LateralRaisePoseIntent } from '../../harness/types';

describe('Lateral Raise — regression: no immediate "not-moving" after calibration', () => {
  it('does NOT fire not-moving within the first 3s after calibration confirms', () => {
    const frames = buildFrames(
      () => ({ abductionDeg: 0 } as LateralRaisePoseIntent),
      buildLateralRaisePose,
      { fps: 30, durationMs: 3200 },
    );
    const result = runLateralRaiseSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThan(500);
    expect(countWarnings(result, 'not-moving')).toBe(0);
  });

  it('DOES fire not-moving after sustained idle past 5s post-calibration', () => {
    const frames = buildFrames(
      () => ({ abductionDeg: 0 } as LateralRaisePoseIntent),
      buildLateralRaisePose,
      { fps: 30, durationMs: 8500 },
    );
    const result = runLateralRaiseSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'not-moving')).toBeGreaterThan(0);
  });
});
