/**
 * Fix B + Fix U: a sustained chest-drop FREEZES the hold counter (valid time is
 * discarded, not wall-clock) and the longest-unfrozen streak tracks the longest
 * clean run rather than total valid time.
 *
 * Timeline: clean lift 8s → chest drops (freeze) 5s → clean lift again 5s.
 *   - total valid hold ≈ 13s (the 5s dropped stretch is discarded)
 *   - longest streak ≈ 8s (the first clean run; the >1s freeze ends the streak)
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildCobraPosePose } from '../../harness/pose-stub';
import { runCobraPoseSession } from '../../harness/runner';
import type { CobraPosePoseIntent } from '../../harness/types';

const CAL_MS = 1000;

describe('Cobra Pose — discard bad-form time (Fix B + Fix U)', () => {
  it('freezes the counter while the chest drops and tracks the longest streak', () => {
    const frames = buildFrames(
      (tMs): CobraPosePoseIntent => {
        if (tMs < CAL_MS) return { elevationDeg: 28, side: 'left' };
        const t = tMs - CAL_MS;
        if (t < 8000) return { elevationDeg: 28, side: 'left' };   // clean 8s
        if (t < 13_000) return { elevationDeg: 10, side: 'left' }; // chest drops (freeze) 5s
        return { elevationDeg: 28, side: 'left' };                 // clean 5s
      },
      buildCobraPosePose,
      { fps: 30, durationMs: CAL_MS + 18_000 },
    );
    const result = runCobraPoseSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.broken).toBe(false);

    const lastTick = result.holdTicks[result.holdTicks.length - 1];
    expect(lastTick.secondsElapsed).toBeGreaterThanOrEqual(11);
    expect(lastTick.secondsElapsed).toBeLessThanOrEqual(15);
    expect(lastTick.longestUnfrozenSec).toBeGreaterThanOrEqual(6);
    expect(lastTick.longestUnfrozenSec).toBeLessThan(lastTick.secondsElapsed);
  });
});
