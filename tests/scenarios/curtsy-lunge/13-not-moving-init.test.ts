/**
 * Regression test for idle 'not-moving' warning on Curtsy Lunge:
 * - standingSince must be initialized at cal-confirm (Fix P) not construction.
 * - After cal-confirm, idle for 5s → 'not-moving' fires (Fix I).
 * - After first fire, idle 14 more s → does NOT fire again (15s cooldown not reached).
 * - After 15s total idle → fires again (NO_MOVEMENT_REPEAT_MS = 15000).
 *
 * Mirrors tests/scenarios/lunge/13-not-moving-init.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildCurtsyLungePose } from '../../harness/pose-stub';
import { runCurtsyLungeSession, countWarnings } from '../../harness/runner';
import type { CurtsyLungePoseIntent } from '../../harness/types';

describe('Curtsy Lunge — regression: no immediate "not-moving" after calibration', () => {
  it('does NOT fire not-moving within the first 3s after calibration confirms', () => {
    // Calibration confirms in ~200ms (instant-confirm). Then 3s of still standing.
    // Total ~3.2s, under the 5s threshold.
    const frames = buildFrames(
      () => ({
        kneeFlexionDeg: 170,
        crossoverRatio: 0,
      } as CurtsyLungePoseIntent),
      buildCurtsyLungePose,
      { fps: 30, durationMs: 3200 },
    );

    const result = runCurtsyLungeSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThan(500);
    expect(countWarnings(result, 'not-moving')).toBe(0);
  });

  it('DOES fire not-moving after sustained idle past 5s post-calibration', () => {
    const frames = buildFrames(
      () => ({
        kneeFlexionDeg: 170,
        crossoverRatio: 0,
      } as CurtsyLungePoseIntent),
      buildCurtsyLungePose,
      { fps: 30, durationMs: 8500 },
    );

    const result = runCurtsyLungeSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'not-moving')).toBeGreaterThan(0);
  });

  it('fires not-moving exactly once between 5s and 14s idle (15s repeat cooldown)', () => {
    // Calibrate, then idle for 14s. Should fire once around 5s, not twice.
    const frames = buildFrames(
      () => ({
        kneeFlexionDeg: 170,
        crossoverRatio: 0,
      } as CurtsyLungePoseIntent),
      buildCurtsyLungePose,
      { fps: 30, durationMs: 14000 },
    );

    const result = runCurtsyLungeSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    // Should fire once at ~5s, not twice (14s < 5s + 15s repeat cooldown)
    expect(countWarnings(result, 'not-moving')).toBe(1);
  });

  it('fires not-moving a second time after 5s + 15s = 20s of total idle', () => {
    // Calibrate then idle for 22s → should fire twice (at ~5s and ~20s)
    const frames = buildFrames(
      () => ({
        kneeFlexionDeg: 170,
        crossoverRatio: 0,
      } as CurtsyLungePoseIntent),
      buildCurtsyLungePose,
      { fps: 30, durationMs: 22000 },
    );

    const result = runCurtsyLungeSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'not-moving')).toBeGreaterThanOrEqual(2);
  });
});
