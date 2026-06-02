/**
 * Regression test for Fix I (init-on-cal-confirm) on Pistol Squat.
 * Same pattern as lunge's 13-test: `standingSince = 0` at construction caused
 * the first post-cal frame to report `idleMs = (now - 0)` = millions, instantly
 * firing 'not-moving'. Fix initializes `standingSince = now` on cal-confirm.
 *
 * Also tests Fix P: cold-start sentinel (first fire allowed after 5s
 * without being blocked by cold 0-timestamp).
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildPistolSquatPose } from '../../harness/pose-stub';
import { runPistolSquatSession, countWarnings } from '../../harness/runner';
import type { PistolSquatPoseIntent } from '../../harness/types';

describe('Pistol Squat — regression: no immediate "not-moving" after calibration (Fix I)', () => {
  it('does NOT fire not-moving within the first 3s after calibration confirms', () => {
    // Calibration now confirms in ~200ms. Run ~3 more seconds of stand-still.
    // Total ~3.2s, under the 5s NO_MOVEMENT_TIMEOUT_MS threshold.
    const frames = buildFrames(
      (): PistolSquatPoseIntent => ({
        kneeFlexionDeg: 0,
        standingLeg: 'left',
        armsForward: false,
      }),
      buildPistolSquatPose,
      { fps: 30, durationMs: 3200 },
    );

    const result = runPistolSquatSession(frames);

    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThan(500);
    expect(countWarnings(result, 'not-moving')).toBe(0);
  });

  it('DOES fire not-moving after sustained idle past 5s post-calibration', () => {
    const frames = buildFrames(
      (): PistolSquatPoseIntent => ({
        kneeFlexionDeg: 0,
        standingLeg: 'left',
        armsForward: false,
      }),
      buildPistolSquatPose,
      { fps: 30, durationMs: 8500 },
    );

    const result = runPistolSquatSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'not-moving')).toBeGreaterThan(0);
  });
});
