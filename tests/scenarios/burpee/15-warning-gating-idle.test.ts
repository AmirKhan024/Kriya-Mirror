/**
 * Burpee — warning gating during idle / STANDING.
 * Verifies that form warnings (hip-sag, etc.) are NOT emitted during STANDING.
 * This is essentially the same as 05-warning-gating but named 15- to follow
 * the convention of the lunge test suite.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildBurpeePose } from '../../harness/pose-stub';
import { runBurpeeSession, countWarnings } from '../../harness/runner';
import type { BurpeePoseIntent } from '../../harness/types';

const CAL_MS = 500;

describe('Burpee — form warnings silent during STANDING (Fix A)', () => {
  it('no hip-sag fires during a long STANDING idle with deviation injected', () => {
    // 6s of standing after calibration — user has hipPlankDeviation injected
    // but since they are in STANDING state, hip-sag must NOT fire.
    const totalMs = CAL_MS + 6000;

    const frames = buildFrames(
      (tMs): BurpeePoseIntent => {
        if (tMs < CAL_MS) {
          return { hipYOffset: 0, kneeAngleDeg: 170, bodyHeight: 0.62 };
        }
        return {
          hipYOffset: 0,
          kneeAngleDeg: 170,
          hipPlankDeviation: 0.12, // well above HIP_SAG_THRESHOLD = 0.04
          bodyHeight: 0.62,
        };
      },
      buildBurpeePose,
      { fps: 30, durationMs: totalMs },
    );

    const result = runBurpeeSession(frames);

    expect(result.finalCalibration?.state).toBe('confirmed');
    // Only not-moving should fire (at 5s idle mark)
    expect(countWarnings(result, 'hip-sag')).toBe(0);
    expect(countWarnings(result, 'not-moving')).toBeGreaterThanOrEqual(1);
  });
});
