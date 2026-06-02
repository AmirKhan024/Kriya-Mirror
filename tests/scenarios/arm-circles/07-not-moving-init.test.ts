/**
 * Regression test for Fix I + Fix P on Arm Circles (round 21 re-architected).
 *
 * Fix I: `downSince = 0` at construction caused the first post-cal frame to
 * report `idleMs = (now - 0)` = millions, instantly firing 'not-moving'.
 * Fix initializes `downSince = now` on cal-confirm.
 *
 * Fix P: cold-start cooldown sentinel.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildArmCirclesPose } from '../../harness/pose-stub';
import { runArmCirclesSession, countWarnings } from '../../harness/runner';
import type { ArmCirclesPoseIntent } from '../../harness/types';

describe('Arm Circles — regression: no immediate "not-moving" after calibration', () => {
  it('does NOT fire not-moving within the first 3s after calibration confirms', () => {
    const frames = buildFrames(
      () => ({ abductionDeg: 0 } as ArmCirclesPoseIntent),
      buildArmCirclesPose,
      { fps: 30, durationMs: 3200 },
    );

    const result = runArmCirclesSession(frames);

    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThan(500);
    expect(countWarnings(result, 'not-moving')).toBe(0);
  });

  it('DOES fire not-moving after sustained idle past 5s post-calibration', () => {
    const frames = buildFrames(
      () => ({ abductionDeg: 0 } as ArmCirclesPoseIntent),
      buildArmCirclesPose,
      { fps: 30, durationMs: 8500 },
    );

    const result = runArmCirclesSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'not-moving')).toBeGreaterThan(0);
  });
});
