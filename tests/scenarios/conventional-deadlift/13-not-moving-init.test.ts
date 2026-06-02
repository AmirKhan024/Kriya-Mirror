/**
 * Conventional Deadlift — regression: no immediate "not-moving" after calibration.
 * Fix I + Fix P: standingSince seeded to now on cal-confirm, not standingSince=0 at construction.
 * If not seeded, first post-cal frame has idleMs = (now - 0) = millions → instant not-moving.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildDeadliftPose } from '../../harness/pose-stub';
import { runDeadliftSession, countWarnings } from '../../harness/runner';
import type { DeadliftPoseIntent } from '../../harness/types';

describe('Conventional Deadlift — no immediate not-moving after calibration', () => {
  it('does NOT fire not-moving within 3s of calibration confirming', () => {
    // Calibration confirms in ~200ms; run 3 more seconds of standing still.
    // Total ~3.2s, well under the 5s NO_MOVEMENT_TIMEOUT.
    const frames = buildFrames(
      (): DeadliftPoseIntent => ({ hipHingeDeg: 0, armsAtSides: true }),
      buildDeadliftPose,
      { fps: 30, durationMs: 3200 },
    );
    const result = runDeadliftSession(frames);

    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThan(500);
    expect(countWarnings(result, 'not-moving')).toBe(0);
  });

  it('DOES fire not-moving after standing idle for more than 5s post-calibration', () => {
    const frames = buildFrames(
      (): DeadliftPoseIntent => ({ hipHingeDeg: 0, armsAtSides: true }),
      buildDeadliftPose,
      { fps: 30, durationMs: 8500 },
    );
    const result = runDeadliftSession(frames);

    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'not-moving')).toBeGreaterThan(0);
  });
});
