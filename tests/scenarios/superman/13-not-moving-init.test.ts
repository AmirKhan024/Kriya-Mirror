/**
 * Regression tests for Superman:
 *
 * Fix I — restSince initialized to `now` on cal-confirm (not 0), so the
 * first post-cal frame doesn't compute a massive idle window and instantly fire
 * 'not-moving'.
 *
 * Fix P — cold-start: the 0-sentinel guard must NOT block the first legitimate
 * fire. If the user genuinely idles for > 5 s after calibration, 'not-moving'
 * must fire exactly once.
 *
 * NO_MOVEMENT_TIMEOUT_MS = 5000 ms (Superman spec).
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildSupermanPose } from '../../harness/pose-stub';
import { runSupermanSession, countWarnings } from '../../harness/runner';
import type { SupermanPoseIntent } from '../../harness/types';

describe('Superman — regression: no immediate "not-moving" after calibration (Fix I + Fix P)', () => {
  it('does NOT fire not-moving within the first 3 s after calibration confirms (Fix I)', () => {
    // Calibration confirms in ~300 ms (instant-confirm). Run ~3 more seconds of
    // prone rest. Total ~3.3 s — well under the 5 s timeout.
    const frames = buildFrames(
      () =>
        ({
          shoulderRise: 0,
          armsForward: true,
        } as SupermanPoseIntent),
      buildSupermanPose,
      { fps: 30, durationMs: 3300 },
    );

    const result = runSupermanSession(frames);

    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThan(500);
    expect(countWarnings(result, 'not-moving')).toBe(0);
  });

  it('DOES fire not-moving after sustained idle past 5 s post-calibration (Fix P — cold-start)', () => {
    // Calibration + 6 s of prone idle = total ~6.3 s — over the 5 s gate.
    // Without Fix P the 0-sentinel could block this first fire.
    const frames = buildFrames(
      () =>
        ({
          shoulderRise: 0,
          armsForward: true,
        } as SupermanPoseIntent),
      buildSupermanPose,
      { fps: 30, durationMs: 6300 },
    );

    const result = runSupermanSession(frames);

    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'not-moving')).toBeGreaterThanOrEqual(1);
  });
});
