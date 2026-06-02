/**
 * Fix B (wrong gets discarded) + Fix V (entry/exit hysteresis): sustained
 * bad-form periods freeze the accumulator. Total valid seconds at the end
 * must be strictly less than wall-clock elapsed.
 *
 * Test profile: 10s clean → 5s sustained foot-off-leg → 5s clean.
 * Expected ~15s of valid time (the 5s bad-form window is discarded).
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildTreePosePose } from '../../harness/pose-stub';
import { runTreePoseSession, countWarnings } from '../../harness/runner';
import type { TreePosePoseIntent } from '../../harness/types';

const CAL_MS = 2200;
const HOLD_START = CAL_MS;

describe('Tree Pose — bad-form time is discarded (Fix B + Fix V)', () => {
  it('freezes the hold counter during sustained foot-off-leg', () => {
    const frames = buildFrames(
      (tMs): TreePosePoseIntent => {
        const intoHold = tMs - HOLD_START;
        if (intoHold < 10_000 || intoHold >= 15_000) {
          return { liftedSide: 'left', liftedAnkleXOffset: 0 };
        }
        return { liftedSide: 'left', liftedAnkleXOffset: 0.12 };
      },
      buildTreePosePose,
      { fps: 30, durationMs: HOLD_START + 20_000 },
    );
    const result = runTreePoseSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.broken).toBe(false);
    expect(countWarnings(result, 'foot-off-leg')).toBeGreaterThan(0);

    const lastTick = result.holdTicks[result.holdTicks.length - 1];
    // 20 s wall-clock with 5 s of sustained bad form → accumulated ~15 s
    // (allow ~1 s slack for hysteresis entry/exit debounce).
    expect(lastTick.secondsElapsed).toBeLessThanOrEqual(17);
    expect(lastTick.secondsElapsed).toBeGreaterThanOrEqual(13);
  });
});
