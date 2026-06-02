/**
 * Regression test for Fix P on Glute Bridge: cold-start cooldown for not-moving.
 * `lastNoMovementWarnAt === 0` is treated as "never fired" so the idle clock
 * initialises on cal-confirm, not at construction. Without Fix P, the first
 * post-cal frame would report idleMs = (now - 0) = millions, instantly firing
 * 'not-moving'.
 *
 * NO_MOVEMENT_TIMEOUT_MS = 5000 — must not fire within 3s post-calibration.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildGluteBridgePose } from '../../harness/pose-stub';
import { runGluteBridgeSession, countWarnings } from '../../harness/runner';
import type { GluteBridgePoseIntent } from '../../harness/types';

describe('Glute Bridge — regression: no immediate "not-moving" after calibration', () => {
  it('does NOT fire not-moving within the first 3s after calibration confirms', () => {
    // Calibration confirms in ~200-400ms. Idle for ~3 more seconds — total < 5s threshold.
    const frames = buildFrames(
      () => ({ hipRise: 0 } as GluteBridgePoseIntent),
      buildGluteBridgePose,
      { fps: 30, durationMs: 3200 },
    );
    const result = runGluteBridgeSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThan(500);
    expect(countWarnings(result, 'not-moving')).toBe(0);
  });

  it('DOES fire not-moving after sustained idle past 5s post-calibration', () => {
    // Run for 8.5s total — calibration confirms quickly, then ~8s idle > 5s threshold.
    const frames = buildFrames(
      () => ({ hipRise: 0 } as GluteBridgePoseIntent),
      buildGluteBridgePose,
      { fps: 30, durationMs: 8500 },
    );
    const result = runGluteBridgeSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'not-moving')).toBeGreaterThan(0);
  });
});
