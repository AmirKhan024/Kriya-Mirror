/**
 * Lateral Band Walk — not-moving fires on initial idle after calibration (Fix I + Fix P).
 *
 * Regression: standingSince = 0 at construction caused the first post-cal frame
 * to report idleMs = (now - 0) = millions, instantly firing 'not-moving'.
 * Fix: initialize standingSince = now at calibration confirm.
 *
 * Also tests: NO_MOVEMENT_TIMEOUT_MS = 5000ms spec.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildLateralBandWalkPose } from '../../harness/pose-stub';
import { runLateralBandWalkSession, countWarnings } from '../../harness/runner';
import type { LateralBandWalkPoseIntent } from '../../harness/types';

describe('Lateral Band Walk — not-moving idle detection (Fix I + Fix P)', () => {
  it('does NOT fire not-moving within the first 3s after calibration confirms', () => {
    // Calibration confirms in ~200ms (instant confirm).
    // Then idle for 3s total — 3s is below the 5s threshold.
    const frames = buildFrames(
      (): LateralBandWalkPoseIntent => ({ hipXDisplacement: 0 }),
      buildLateralBandWalkPose,
      { fps: 30, durationMs: 3200 },
    );

    const result = runLateralBandWalkSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThan(500);
    expect(countWarnings(result, 'not-moving')).toBe(0);
  });

  it('DOES fire not-moving after 5s+ of idle standing after calibration', () => {
    // Calibration confirms quickly, then 6s of standing still.
    const frames = buildFrames(
      (): LateralBandWalkPoseIntent => ({ hipXDisplacement: 0 }),
      buildLateralBandWalkPose,
      { fps: 30, durationMs: 8500 },
    );

    const result = runLateralBandWalkSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'not-moving')).toBeGreaterThan(0);
  });

  it('not-moving fires only ONCE within the 15s repeat cooldown', () => {
    // 13s total — should fire at 5s, then not again (cooldown = 15s)
    const frames = buildFrames(
      (): LateralBandWalkPoseIntent => ({ hipXDisplacement: 0 }),
      buildLateralBandWalkPose,
      { fps: 30, durationMs: 13000 },
    );

    const result = runLateralBandWalkSession(frames);
    expect(countWarnings(result, 'not-moving')).toBe(1);
  });

  it('does NOT fire not-moving immediately after calibration (Fix I regression)', () => {
    // Calibration happens at ~200ms. If standingSince = 0 at construction,
    // idleMs would be millions and not-moving would fire at the very first
    // post-cal frame. This test catches that regression.
    const frames = buildFrames(
      (): LateralBandWalkPoseIntent => ({ hipXDisplacement: 0 }),
      buildLateralBandWalkPose,
      { fps: 30, durationMs: 1000 }, // only 1s — well below 5s threshold
    );

    const result = runLateralBandWalkSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'not-moving')).toBe(0);
  });
});
