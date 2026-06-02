/**
 * Regression test for round-5 §3.7 init-on-cal-confirm fix on Bicep Curl.
 * Same pattern as squat/lunge/pushup 13-test: `extendedSince = 0` at
 * construction caused the first post-cal frame to report `idleMs = (now - 0)`
 * = millions, instantly firing 'not-moving'. Fix initializes
 * `extendedSince = now` on cal-confirm.
 *
 * Plus the round-5 spec change: NO_MOVEMENT_TIMEOUT_MS dropped 12000 → 5000.
 * Plus the cold-start cooldown fix: `lastNoMovementWarnAt === 0` is treated
 * as "never fired" so the first idle warning isn't suppressed by the 15s repeat
 * cooldown when the engine timestamp is still small.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildBicepCurlPose } from '../../harness/pose-stub';
import { runBicepCurlSession, countWarnings } from '../../harness/runner';
import type { BicepCurlPoseIntent } from '../../harness/types';

describe('Bicep Curl — regression: no immediate "not-moving" after calibration (2026-05-25)', () => {
  it('does NOT fire not-moving within the first 3s after calibration confirms', () => {
    // Calibration now confirms in ~200ms (round-5 instant-confirm). Run ~3
    // more seconds of arms-at-sides stillness. Total ~3.2s, under the 5s threshold.
    const frames = buildFrames(
      () => ({ elbowFlexionDeg: 0 } as BicepCurlPoseIntent),
      buildBicepCurlPose,
      { fps: 30, durationMs: 3200 },
    );

    const result = runBicepCurlSession(frames);

    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThan(500);
    expect(countWarnings(result, 'not-moving')).toBe(0);
  });

  it('DOES fire not-moving after sustained idle past 5s post-calibration', () => {
    const frames = buildFrames(
      () => ({ elbowFlexionDeg: 0 } as BicepCurlPoseIntent),
      buildBicepCurlPose,
      { fps: 30, durationMs: 8500 },
    );

    const result = runBicepCurlSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'not-moving')).toBeGreaterThan(0);
  });
});
