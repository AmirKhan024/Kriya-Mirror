/**
 * Regression test for engine bug A / Fix I / Fix P.
 *
 * Symptom: standingSince = 0 at engine init → first STANDING frame post-cal
 * reports idleMs = (now - 0) = millions → instant false-positive 'not-moving'.
 *
 * Fix: initialize standingSince = now when calibration confirms.
 *
 * This test confirms zero 'not-moving' warnings fire in the first 3 seconds
 * after calibration confirm (under the 5s NO_MOVEMENT_TIMEOUT_MS).
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildGobletSquatPose } from '../../harness/pose-stub';
import { runGobletSquatSession, countWarnings } from '../../harness/runner';
import type { GobletSquatPoseIntent } from '../../harness/types';

describe('Goblet Squat — regression: no immediate "not-moving" after calibration (Fix I+P)', () => {
  it('does NOT fire not-moving within the first 3s after calibration confirms', () => {
    // Calibration confirms in ~200ms (instant-confirm). Run 3 more seconds of stand-still.
    // Total ~3.2s, under the 5s threshold.
    const frames = buildFrames(
      (): GobletSquatPoseIntent => ({
        kneeFlexionDeg: 0,
        feetWidthRatio: 1.25,
        elbowSpreadRatio: 1.0,
        bodyHeight: 0.70,
      }),
      buildGobletSquatPose,
      { fps: 30, durationMs: 3200 },
    );

    const result = runGobletSquatSession(frames);

    // Sanity: calibration confirmed
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThan(500);

    // Bug pre-fix: not-moving fires within ~25ms of calibration confirm.
    // Post-fix: should not fire at all in this window.
    expect(countWarnings(result, 'not-moving')).toBe(0);
  });

  it('DOES fire not-moving after sustained idle past 5s post-calibration', () => {
    // Idle for 8s should still trigger.
    const frames = buildFrames(
      (): GobletSquatPoseIntent => ({
        kneeFlexionDeg: 0,
        feetWidthRatio: 1.25,
        elbowSpreadRatio: 1.0,
        bodyHeight: 0.70,
      }),
      buildGobletSquatPose,
      { fps: 30, durationMs: 8500 },
    );

    const result = runGobletSquatSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'not-moving')).toBeGreaterThan(0);
  });
});
