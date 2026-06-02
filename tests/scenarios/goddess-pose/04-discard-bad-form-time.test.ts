/**
 * Fix B (wrong gets discarded) + Fix V (entry/exit hysteresis):
 * sustained bad-form periods freeze the accumulator. Final valid seconds
 * must be strictly less than wall-clock elapsed.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildGoddessPosePose } from '../../harness/pose-stub';
import { runGoddessPoseSession, countWarnings } from '../../harness/runner';
import type { GoddessPosePoseIntent } from '../../harness/types';

const CAL_MS = 2200;
const HOLD_START = CAL_MS;

describe('Goddess Pose — bad-form time is discarded (Fix B + Fix V)', () => {
  it('freezes the hold counter during a sustained knees-caving window', () => {
    const frames = buildFrames(
      (tMs): GoddessPosePoseIntent => {
        const intoHold = tMs - HOLD_START;
        // Phase 1 (0-10s): clean. Phase 2 (10-15s): knees caving.
        // Phase 3 (15-20s): clean again.
        if (intoHold < 10_000 || intoHold >= 15_000) {
          return { kneeFlexionDeg: 90 };
        }
        return { kneeFlexionDeg: 90, kneeAnkleRatio: 0.5 };
      },
      buildGoddessPosePose,
      { fps: 30, durationMs: HOLD_START + 20_000 },
    );
    const result = runGoddessPoseSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.broken).toBe(false);
    expect(countWarnings(result, 'knees-caving')).toBeGreaterThan(0);

    const lastTick = result.holdTicks[result.holdTicks.length - 1];
    // 20s wall-clock with ~5s of sustained bad form → ~15s valid.
    expect(lastTick.secondsElapsed).toBeLessThanOrEqual(17);
    expect(lastTick.secondsElapsed).toBeGreaterThanOrEqual(13);
  });

  it('freezes the counter on sustained arms-dropped (independent warning)', () => {
    const frames = buildFrames(
      (tMs): GoddessPosePoseIntent => {
        const intoHold = tMs - HOLD_START;
        if (intoHold < 8000 || intoHold >= 13_000) {
          return { kneeFlexionDeg: 90 };
        }
        return { kneeFlexionDeg: 90, elbowDropFraction: 0.30 };
      },
      buildGoddessPosePose,
      { fps: 30, durationMs: HOLD_START + 18_000 },
    );
    const result = runGoddessPoseSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'arms-dropped')).toBeGreaterThan(0);

    const lastTick = result.holdTicks[result.holdTicks.length - 1];
    // 18s wall-clock with ~5s sustained bad → ~13s valid.
    expect(lastTick.secondsElapsed).toBeLessThanOrEqual(15);
    expect(lastTick.secondsElapsed).toBeGreaterThanOrEqual(11);
  });

  it('does NOT freeze on single-frame jitter (Fix V hysteresis)', () => {
    const frames = buildFrames(
      (tMs): GoddessPosePoseIntent => {
        const intoHold = tMs - HOLD_START;
        // 1 frame of bad form every ~1000 ms — below the 6-frame entry debounce.
        const isBadFrame = intoHold > 0 && Math.floor(intoHold / 33) % 30 === 0;
        return { kneeFlexionDeg: 90, kneeAnkleRatio: isBadFrame ? 0.5 : 1.0 };
      },
      buildGoddessPosePose,
      { fps: 30, durationMs: HOLD_START + 10_000 },
    );
    const result = runGoddessPoseSession(frames);
    expect(countWarnings(result, 'knees-caving')).toBe(0);
    const lastTick = result.holdTicks[result.holdTicks.length - 1];
    expect(lastTick.secondsElapsed).toBeGreaterThanOrEqual(9);
  });
});
