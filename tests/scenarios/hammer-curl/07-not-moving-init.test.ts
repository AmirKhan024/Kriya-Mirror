/**
 * Fix P regression: `lastNoMovementWarnAt === 0` sentinel — the first idle
 * warning post-calibration must not be suppressed by the 15s repeat cooldown
 * when the engine timestamp is still small.
 *
 * Also: `extendedSince` is initialized to `now` on cal-confirm so the first
 * post-cal frame never reports a stale idle duration.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildHammerCurlPose } from '../../harness/pose-stub';
import { runHammerCurlSession, countWarnings } from '../../harness/runner';
import type { HammerCurlPoseIntent } from '../../harness/types';

describe('Hammer Curl — regression: no immediate "not-moving" after calibration', () => {
  it('does NOT fire not-moving within the first 3s after calibration confirms', () => {
    const frames = buildFrames(
      () => ({ elbowFlexionDeg: 0 } as HammerCurlPoseIntent),
      buildHammerCurlPose,
      { fps: 30, durationMs: 3200 },
    );

    const result = runHammerCurlSession(frames);

    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThan(500);
    expect(countWarnings(result, 'not-moving')).toBe(0);
  });

  it('DOES fire not-moving after sustained idle past 5s post-calibration', () => {
    const frames = buildFrames(
      () => ({ elbowFlexionDeg: 0 } as HammerCurlPoseIntent),
      buildHammerCurlPose,
      { fps: 30, durationMs: 8500 },
    );

    const result = runHammerCurlSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'not-moving')).toBeGreaterThan(0);
  });
});
