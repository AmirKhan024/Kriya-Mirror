/**
 * Fix N — cross-cutting `position-lost` warning. If no usable pose frame
 * (landmarks null OR core body landmarks not visible) for ≥ 3 s post-calibration,
 * the engine emits `position-lost`, repeating at most every 10 s while lost.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildCobraPosePose } from '../../harness/pose-stub';
import { runCobraPoseSession, countWarnings } from '../../harness/runner';
import type { CobraPosePoseIntent } from '../../harness/types';

const CAL_MS = 1000;

describe('Cobra Pose — position-lost (Fix N)', () => {
  it('fires position-lost after 3+ seconds of null landmarks post-calibration', () => {
    const frames = buildFrames(
      (tMs): CobraPosePoseIntent | null =>
        tMs < CAL_MS ? { elevationDeg: 28, side: 'left' } : null,
      buildCobraPosePose,
      { fps: 30, durationMs: CAL_MS + 4000 },
    );
    const result = runCobraPoseSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'position-lost')).toBeGreaterThan(0);
  });

  it('does NOT fire position-lost on a clean continuous stream', () => {
    const frames = buildFrames(
      (): CobraPosePoseIntent => ({ elevationDeg: 28, side: 'left' }),
      buildCobraPosePose,
      { fps: 30, durationMs: CAL_MS + 4000 },
    );
    const result = runCobraPoseSession(frames);
    expect(countWarnings(result, 'position-lost')).toBe(0);
  });

  it('does NOT re-fire position-lost within the 10s cooldown', () => {
    const frames = buildFrames(
      (tMs): CobraPosePoseIntent | null =>
        tMs < CAL_MS ? { elevationDeg: 28, side: 'left' } : null,
      buildCobraPosePose,
      { fps: 30, durationMs: CAL_MS + 5000 },
    );
    const result = runCobraPoseSession(frames);
    expect(countWarnings(result, 'position-lost')).toBe(1);
  });
});
