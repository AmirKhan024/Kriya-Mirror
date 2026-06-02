/**
 * Regression test for round-5 §3.7 init-on-cal-confirm fix on Push-Up.
 *
 * Symptom (same pattern as squat's pre-fix bug):
 *   [CALIB] CONFIRMED (t=Xms)
 *   [WARN] not-moving | {"idleMs":huge,"flexVariance":0} (t=X+25ms)
 *
 * Bug: `topSince = 0` at engine construction, only reset on TOP → another →
 * TOP transition. The engine STARTS in TOP so it stays at 0 until the first
 * rep — meaning the first post-cal frame reports idleMs = (now - 0) =
 * millions, instantly firing 'not-moving'.
 *
 * Fix: initialize `topSince = now` when calibration confirms.
 *
 * Plus the round-5 spec change: NO_MOVEMENT_TIMEOUT_MS dropped 12000 → 5000.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildPushupPose } from '../../harness/pose-stub';
import { runPushupSession, countWarnings } from '../../harness/runner';
import type { PushupPoseIntent } from '../../harness/types';

describe('Push-Up — regression: no immediate "not-moving" after calibration (2026-05-25)', () => {
  it('does NOT fire not-moving within the first 3s after calibration confirms', () => {
    // Calibration now confirms in ~200ms (round-5 instant-confirm). Run ~3
    // more seconds of stand-still in TOP. Total ~3.2s, under the 5s threshold.
    const frames = buildFrames(
      () => ({
        elbowFlexionDeg: 0,
        side: 'left' as const,
      } as PushupPoseIntent),
      buildPushupPose,
      { fps: 30, durationMs: 3200 },
    );

    const result = runPushupSession(frames);

    // Sanity: calibration confirmed
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThan(500);

    // The bug: pre-fix, not-moving fires within ~25ms of calibration confirm.
    // Post-fix: should not fire at all in this window.
    expect(countWarnings(result, 'not-moving')).toBe(0);
  });

  it('DOES fire not-moving after sustained idle past 5s post-calibration', () => {
    // Sanity check the other direction — idle in TOP for 8.5s should still
    // trigger the warning.
    const frames = buildFrames(
      () => ({
        elbowFlexionDeg: 0,
        side: 'left' as const,
      } as PushupPoseIntent),
      buildPushupPose,
      { fps: 30, durationMs: 8500 },
    );

    const result = runPushupSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'not-moving')).toBeGreaterThan(0);
  });
});
