/**
 * Fix B (wrong gets discarded) + Fix V (entry/exit hysteresis):
 * sustained bad-form periods freeze the accumulator. Final valid seconds
 * must be strictly less than wall-clock elapsed.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildWarriorOnePose } from '../../harness/pose-stub';
import { runWarriorOneSession, countWarnings } from '../../harness/runner';
import type { WarriorOnePoseIntent } from '../../harness/types';

const CAL_MS = 2200;
const HOLD_START = CAL_MS;

describe('Warrior I — bad-form time is discarded (Fix B + Fix V)', () => {
  it('freezes the hold counter during sustained front-knee-not-bent-enough', () => {
    const frames = buildFrames(
      (tMs): WarriorOnePoseIntent => {
        const intoHold = tMs - HOLD_START;
        // Phase 1 (0-10s): clean. Phase 2 (10-15s): front knee straightens.
        // Phase 3 (15-20s): clean again.
        if (intoHold < 10_000 || intoHold >= 15_000) {
          return { frontKneeFlexionDeg: 90 };
        }
        return { frontKneeFlexionDeg: 35 };
      },
      buildWarriorOnePose,
      { fps: 30, durationMs: HOLD_START + 20_000 },
    );
    const result = runWarriorOneSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.broken).toBe(false);
    expect(countWarnings(result, 'front-knee-not-bent-enough')).toBeGreaterThan(0);

    const lastTick = result.holdTicks[result.holdTicks.length - 1];
    // 20s wall-clock with 5s of sustained bad form → ~15s valid.
    expect(lastTick.secondsElapsed).toBeLessThanOrEqual(17);
    expect(lastTick.secondsElapsed).toBeGreaterThanOrEqual(13);
  });

  it('does NOT freeze on single-frame jitter (Fix V hysteresis)', () => {
    const frames = buildFrames(
      (tMs): WarriorOnePoseIntent => {
        const intoHold = tMs - HOLD_START;
        // 1 frame of bad form every 1000 ms.
        const isBadFrame = intoHold > 0 && Math.floor(intoHold / 33) % 30 === 0;
        return { frontKneeFlexionDeg: isBadFrame ? 45 : 90 };
      },
      buildWarriorOnePose,
      { fps: 30, durationMs: HOLD_START + 10_000 },
    );
    const result = runWarriorOneSession(frames);
    expect(countWarnings(result, 'front-knee-not-bent-enough')).toBe(0);
    const lastTick = result.holdTicks[result.holdTicks.length - 1];
    expect(lastTick.secondsElapsed).toBeGreaterThanOrEqual(9);
  });
});
