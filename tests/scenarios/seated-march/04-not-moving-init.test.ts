/**
 * Fix I + Fix P: no immediate "not-moving" right after calibration (idle timer
 * seeded to `now` on cal-confirm), but it DOES fire after sustained idle past 5 s.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildSeatedMarchPose } from '../../harness/pose-stub';
import { runSeatedMarchSession, countWarnings } from '../../harness/runner';
import type { SeatedMarchPoseIntent } from '../../harness/types';

describe('Seated March — no immediate "not-moving" after calibration', () => {
  it('does NOT fire not-moving within the first 3s after calibration confirms', () => {
    const frames = buildFrames(
      (): SeatedMarchPoseIntent => ({ leftKneeLiftPct: 0, rightKneeLiftPct: 0 }),
      buildSeatedMarchPose,
      { fps: 30, durationMs: 3200 },
    );
    const result = runSeatedMarchSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThan(600);
    expect(countWarnings(result, 'not-moving')).toBe(0);
  });

  it('DOES fire not-moving after sustained idle past 5s post-calibration', () => {
    const frames = buildFrames(
      (): SeatedMarchPoseIntent => ({ leftKneeLiftPct: 0, rightKneeLiftPct: 0 }),
      buildSeatedMarchPose,
      { fps: 30, durationMs: 8500 },
    );
    const result = runSeatedMarchSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'not-moving')).toBeGreaterThan(0);
  });
});
