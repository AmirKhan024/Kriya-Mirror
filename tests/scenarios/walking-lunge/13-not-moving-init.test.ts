/**
 * Regression test for round-5 §3.7 init-on-cal-confirm fix on Walking Lunge.
 * Same pattern as squat's 13-test: `standingSince = 0` at construction caused
 * the first post-cal frame to report `idleMs = (now - 0)` = millions, instantly
 * firing 'not-moving'. Fix initializes `standingSince = now` on cal-confirm.
 *
 * Plus the round-5 spec change: NO_MOVEMENT_TIMEOUT_MS dropped 12000 → 5000.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildLungePose } from '../../harness/pose-stub';
import { runWalkingLungeSession, countWarnings } from '../../harness/runner';
import type { LungePoseIntent } from '../../harness/types';

describe('Walking Lunge — regression: no immediate "not-moving" after calibration (2026-05-25)', () => {
  it('does NOT fire not-moving within the first 3s after calibration confirms', () => {
    // Calibration now confirms in ~200ms (round-5 instant-confirm). Run ~3
    // more seconds of stand-still. Total ~3.2s, under the 5s threshold.
    const frames = buildFrames(
      () => ({
        kneeFlexionDeg: 0,
        frontLeg: 'left' as const,
        armsAtSides: true,
      } as LungePoseIntent),
      buildLungePose,
      { fps: 30, durationMs: 3200 },
    );

    const result = runWalkingLungeSession(frames);

    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThan(500);
    expect(countWarnings(result, 'not-moving')).toBe(0);
  });

  it('DOES fire not-moving after sustained idle past 5s post-calibration', () => {
    const frames = buildFrames(
      () => ({
        kneeFlexionDeg: 0,
        frontLeg: 'left' as const,
        armsAtSides: true,
      } as LungePoseIntent),
      buildLungePose,
      { fps: 30, durationMs: 8500 },
    );

    const result = runWalkingLungeSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'not-moving')).toBeGreaterThan(0);
  });
});
