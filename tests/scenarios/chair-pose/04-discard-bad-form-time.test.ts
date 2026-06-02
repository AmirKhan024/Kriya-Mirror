/**
 * Fix B (wrong gets discarded) + Fix V (entry/exit hysteresis): a sustained
 * bad-form period mid-hold should FREEZE the accumulator. Total valid seconds
 * at the end must be strictly less than wall-clock elapsed.
 *
 * Construct: 10s of clean form → 5s of sustained knee-too-straight → 5s clean.
 * Expected accumulated valid time ≈ 15s (the 5s of bad form is discarded).
 * Without Fix B, accumulated would equal wall-clock ~20s. Without Fix V, the
 * accumulator would chatter on/off and produce a value somewhere in between.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildChairPosePose } from '../../harness/pose-stub';
import { runChairPoseSession, countWarnings } from '../../harness/runner';
import type { ChairPosePoseIntent } from '../../harness/types';

const CAL_MS = 2200;
const HOLD_START = CAL_MS;

describe('Chair Pose — bad-form time is discarded (Fix B + Fix V)', () => {
  it('freezes the hold counter during sustained knee-too-straight', () => {
    const frames = buildFrames(
      (tMs): ChairPosePoseIntent => {
        const intoHold = tMs - HOLD_START;
        // Phase 1 (0-10s): clean
        // Phase 2 (10-15s): knees straight (warning fires after 6 frames ≈ 200ms)
        // Phase 3 (15-20s): clean again
        if (intoHold < 10_000 || intoHold >= 15_000) {
          return { kneeFlexionDeg: 90, side: 'left' };
        }
        return { kneeFlexionDeg: 25, side: 'left' };
      },
      buildChairPosePose,
      { fps: 30, durationMs: HOLD_START + 20_000 },
    );
    const result = runChairPoseSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.broken).toBe(false);
    expect(countWarnings(result, 'knee-too-straight')).toBeGreaterThan(0);

    // Final secondsElapsed (accumulated valid hold time) must clearly exclude
    // most of the 5-second bad-form window. Allow ~1s slack for the hysteresis
    // entry/exit debounce that lets a few bad frames sneak into the counter.
    const lastTick = result.holdTicks[result.holdTicks.length - 1];
    expect(lastTick.secondsElapsed).toBeLessThanOrEqual(17);
    expect(lastTick.secondsElapsed).toBeGreaterThanOrEqual(13);
  });

  it('does NOT freeze on a single-frame jitter (Fix V hysteresis requires 6 sustained bad frames)', () => {
    // Inject ONE bad frame every second — never enough to trigger the
    // warning, so the accumulator should stay near wall-clock.
    const frames = buildFrames(
      (tMs): ChairPosePoseIntent => {
        const intoHold = tMs - HOLD_START;
        // 1 frame of bad form every 1000ms (1 in 30 frames).
        const isBadFrame = intoHold > 0 && Math.floor(intoHold / 33) % 30 === 0;
        return { kneeFlexionDeg: isBadFrame ? 30 : 90, side: 'left' };
      },
      buildChairPosePose,
      { fps: 30, durationMs: HOLD_START + 10_000 },
    );
    const result = runChairPoseSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'knee-too-straight')).toBe(0);
    const lastTick = result.holdTicks[result.holdTicks.length - 1];
    // 10 seconds of wall-clock; single-frame blips never triggered hysteresis,
    // and EMA smoothing kept the metric well above the 50° threshold.
    expect(lastTick.secondsElapsed).toBeGreaterThanOrEqual(9);
  });
});
