/**
 * Fix I + Fix P — `not-moving` idle prompt. After calibration confirms, if the
 * user just sits there (no stand-ups) for ≥ 5s, fire `not-moving`. Fix P: the
 * cold-start cooldown must allow the FIRST fire.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildChairPosePose } from '../../harness/pose-stub';
import { runSitToStandSession, countWarnings } from '../../harness/runner';
import type { ChairPosePoseIntent } from '../../harness/types';

describe('Sit-to-Stand — not-moving idle prompt (Fix I/P)', () => {
  it('fires not-moving after ~5s of sitting still post-calibration', () => {
    const frames = buildFrames(
      () => ({ kneeFlexionDeg: 90, side: 'left' } as ChairPosePoseIntent),
      buildChairPosePose,
      { fps: 30, durationMs: 8000 },
    );
    const result = runSitToStandSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'not-moving')).toBeGreaterThanOrEqual(1);
  });
});
