/**
 * Fix B (wrong gets discarded) + Fix V (entry/exit hysteresis): sustained
 * bad-form periods freeze the accumulator. Final valid seconds < wall-clock.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildSidePlankPose } from '../../harness/pose-stub';
import { runSidePlankSession, countWarnings } from '../../harness/runner';
import type { SidePlankPoseIntent } from '../../harness/types';

const CAL_MS = 2200;
const HOLD_START = CAL_MS;

describe('Side Plank — bad-form time is discarded (Fix B + Fix V)', () => {
  it('freezes the hold counter during a sustained hip-sag', () => {
    const frames = buildFrames(
      (tMs): SidePlankPoseIntent => {
        const intoHold = tMs - HOLD_START;
        // Clean 0-10s, hips sag 10-15s, clean again 15-20s.
        return { hipDelta: (intoHold >= 10_000 && intoHold < 15_000) ? 0.08 : 0 };
      },
      buildSidePlankPose,
      { fps: 30, durationMs: HOLD_START + 20_000 },
    );
    const result = runSidePlankSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.broken).toBe(false);
    expect(countWarnings(result, 'hip-sag')).toBeGreaterThan(0);

    const lastTick = result.holdTicks[result.holdTicks.length - 1];
    // ~22s of hold with ~5s frozen → ~17s valid.
    expect(lastTick.secondsElapsed).toBeLessThanOrEqual(18);
    expect(lastTick.secondsElapsed).toBeGreaterThanOrEqual(12);
  });

  it('does NOT freeze on single-frame jitter (Fix V hysteresis)', () => {
    const frames = buildFrames(
      (tMs): SidePlankPoseIntent => {
        const intoHold = tMs - HOLD_START;
        const isBadFrame = intoHold > 0 && Math.floor(intoHold / 33) % 30 === 0;
        return { hipDelta: isBadFrame ? 0.08 : 0 };
      },
      buildSidePlankPose,
      { fps: 30, durationMs: HOLD_START + 10_000 },
    );
    const result = runSidePlankSession(frames);
    expect(countWarnings(result, 'hip-sag')).toBe(0);
    const lastTick = result.holdTicks[result.holdTicks.length - 1];
    expect(lastTick.secondsElapsed).toBeGreaterThanOrEqual(9);
  });
});
