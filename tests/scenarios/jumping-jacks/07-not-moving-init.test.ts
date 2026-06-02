/**
 * Regression test for Fix I + Fix P on Jumping Jacks.
 *
 * Fix I: `closedSince = 0` at construction caused the first post-cal frame to
 * report `idleMs = (now - 0)` = millions, instantly firing 'not-moving'.
 * Fix initializes `closedSince = now` on cal-confirm.
 *
 * Fix P (cold-start cooldown): `lastNoMovementWarnAt === 0` is treated as
 * "never fired" so the first idle warning isn't suppressed by the 15 s
 * cooldown when the engine timestamp is still small.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildJumpingJacksPose } from '../../harness/pose-stub';
import { runJumpingJacksSession, countWarnings } from '../../harness/runner';
import type { JumpingJacksPoseIntent } from '../../harness/types';

describe('Jumping Jacks — regression: no immediate "not-moving" after calibration', () => {
  it('does NOT fire not-moving within the first 3s after calibration confirms', () => {
    const frames = buildFrames(
      () => ({ armOpennessPct: 0, legOpennessPct: 30 } as JumpingJacksPoseIntent),
      buildJumpingJacksPose,
      { fps: 30, durationMs: 3200 },
    );

    const result = runJumpingJacksSession(frames);

    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThan(500);
    expect(countWarnings(result, 'not-moving')).toBe(0);
  });

  it('DOES fire not-moving after sustained idle past 5s post-calibration', () => {
    const frames = buildFrames(
      () => ({ armOpennessPct: 0, legOpennessPct: 30 } as JumpingJacksPoseIntent),
      buildJumpingJacksPose,
      { fps: 30, durationMs: 8500 },
    );

    const result = runJumpingJacksSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'not-moving')).toBeGreaterThan(0);
  });
});
