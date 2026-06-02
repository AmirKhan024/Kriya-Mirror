/**
 * Fix I + Fix P — `not-moving` idle prompt. After calibration confirms, if the
 * user stands still (no lunges) for ≥ 5s, fire `not-moving`. Fix P: the
 * cold-start cooldown must allow the FIRST fire.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildLungePose } from '../../harness/pose-stub';
import { runReverseLungeSession, countWarnings } from '../../harness/runner';
import type { LungePoseIntent } from '../../harness/types';

describe('Reverse Lunge — not-moving idle prompt (Fix I/P)', () => {
  it('fires not-moving after ~5s of standing still post-calibration', () => {
    const frames = buildFrames(
      () => ({ kneeFlexionDeg: 0, frontLeg: 'left', armsAtSides: true } as LungePoseIntent),
      buildLungePose,
      { fps: 30, durationMs: 8000 },
    );
    const result = runReverseLungeSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'not-moving')).toBeGreaterThanOrEqual(1);
  });
});
