/**
 * Fix B (wrong gets discarded) + Fix V (entry/exit hysteresis):
 * sustained bad-form periods freeze the accumulator. Final valid seconds
 * must be strictly less than wall-clock elapsed.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildTrianglePosePose } from '../../harness/pose-stub';
import { runTrianglePoseSession, countWarnings } from '../../harness/runner';
import type { TrianglePosePoseIntent } from '../../harness/types';

const CAL_MS = 2200;
const HOLD_START = CAL_MS;

describe('Triangle Pose — bad-form time is discarded (Fix B + Fix V)', () => {
  it('freezes the hold counter during a sustained leg-not-straight window', () => {
    const frames = buildFrames(
      (tMs): TrianglePosePoseIntent => {
        const intoHold = tMs - HOLD_START;
        // Phase 1 (0–10s): clean. Phase 2 (10–15s): front knee bends.
        // Phase 3 (15–20s): clean again.
        if (intoHold < 10_000 || intoHold >= 15_000) return {};
        return { frontKneeFlexionDeg: 45 };
      },
      buildTrianglePosePose,
      { fps: 30, durationMs: HOLD_START + 20_000 },
    );
    const result = runTrianglePoseSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.broken).toBe(false);
    expect(countWarnings(result, 'leg-not-straight')).toBeGreaterThan(0);

    const lastTick = result.holdTicks[result.holdTicks.length - 1];
    // 20s wall-clock with ~5s sustained bad form → ~15s valid.
    expect(lastTick.secondsElapsed).toBeLessThanOrEqual(17);
    expect(lastTick.secondsElapsed).toBeGreaterThanOrEqual(13);
  });

  it('freezes the counter on sustained bottom-arm-not-down', () => {
    const frames = buildFrames(
      (tMs): TrianglePosePoseIntent => {
        const intoHold = tMs - HOLD_START;
        if (intoHold < 8000 || intoHold >= 13_000) return {};
        return { bottomArmLiftFromAnkle: 0.40 };
      },
      buildTrianglePosePose,
      { fps: 30, durationMs: HOLD_START + 18_000 },
    );
    const result = runTrianglePoseSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'bottom-arm-not-down')).toBeGreaterThan(0);

    const lastTick = result.holdTicks[result.holdTicks.length - 1];
    // 18s wall-clock with ~5s sustained bad → ~13s valid.
    expect(lastTick.secondsElapsed).toBeLessThanOrEqual(15);
    expect(lastTick.secondsElapsed).toBeGreaterThanOrEqual(11);
  });

  it('does NOT freeze on single-frame jitter (Fix V hysteresis)', () => {
    const frames = buildFrames(
      (tMs): TrianglePosePoseIntent => {
        const intoHold = tMs - HOLD_START;
        // 1 frame of bad form every ~1000 ms — below the 6-frame entry debounce.
        const isBadFrame = intoHold > 0 && Math.floor(intoHold / 33) % 30 === 0;
        return { frontKneeFlexionDeg: isBadFrame ? 50 : 5 };
      },
      buildTrianglePosePose,
      { fps: 30, durationMs: HOLD_START + 10_000 },
    );
    const result = runTrianglePoseSession(frames);
    expect(countWarnings(result, 'leg-not-straight')).toBe(0);
    const lastTick = result.holdTicks[result.holdTicks.length - 1];
    expect(lastTick.secondsElapsed).toBeGreaterThanOrEqual(9);
  });
});
