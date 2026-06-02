/**
 * Fix B (wrong gets discarded) + Fix V (entry/exit hysteresis): a sustained
 * bad-form period mid-hold should FREEZE the accumulator. Total valid seconds
 * at the end must be strictly less than wall-clock elapsed.
 *
 * Construct: 10s clean → 5s sustained knee-too-straight → 5s clean.
 * Expected accumulated valid time ≈ 15s (the 5s bad window is discarded).
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildWallSitPose } from '../../harness/pose-stub';
import { runWallSitSession, countWarnings } from '../../harness/runner';
import type { WallSitPoseIntent } from '../../harness/types';

const CAL_MS = 2200;
const HOLD_START = CAL_MS;

describe('Wall Sit — bad-form time is discarded (Fix B + Fix V)', () => {
  it('freezes the hold counter during sustained knee-too-straight', () => {
    const frames = buildFrames(
      (tMs): WallSitPoseIntent => {
        const intoHold = tMs - HOLD_START;
        if (intoHold < 10_000 || intoHold >= 15_000) {
          return { kneeFlexionDeg: 90, side: 'left' };
        }
        return { kneeFlexionDeg: 25, side: 'left' };
      },
      buildWallSitPose,
      { fps: 30, durationMs: HOLD_START + 20_000 },
    );
    const result = runWallSitSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.broken).toBe(false);
    expect(countWarnings(result, 'knee-too-straight')).toBeGreaterThan(0);

    const lastTick = result.holdTicks[result.holdTicks.length - 1];
    expect(lastTick.secondsElapsed).toBeLessThanOrEqual(17);
    expect(lastTick.secondsElapsed).toBeGreaterThanOrEqual(13);
  });

  it('does NOT freeze on a single-frame jitter (Fix V hysteresis requires 6 sustained bad frames)', () => {
    const frames = buildFrames(
      (tMs): WallSitPoseIntent => {
        const intoHold = tMs - HOLD_START;
        const isBadFrame = intoHold > 0 && Math.floor(intoHold / 33) % 30 === 0;
        return { kneeFlexionDeg: isBadFrame ? 35 : 90, side: 'left' };
      },
      buildWallSitPose,
      { fps: 30, durationMs: HOLD_START + 10_000 },
    );
    const result = runWallSitSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'knee-too-straight')).toBe(0);
    const lastTick = result.holdTicks[result.holdTicks.length - 1];
    expect(lastTick.secondsElapsed).toBeGreaterThanOrEqual(9);
  });
});
