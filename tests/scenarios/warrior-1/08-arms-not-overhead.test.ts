/**
 * Warrior I's signature metric — arms must stay overhead for the duration of
 * the hold. If the wrists drop below the shoulders mid-hold, `arms-not-overhead`
 * fires (recoverable per Fix S — freezes the timer but doesn't terminate).
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildWarriorOnePose } from '../../harness/pose-stub';
import { runWarriorOneSession, countWarnings } from '../../harness/runner';
import type { WarriorOnePoseIntent } from '../../harness/types';

const CAL_MS = 2200;
const HOLD_START = CAL_MS;

describe('Warrior I — arms-not-overhead warning', () => {
  it('fires arms-not-overhead when wrists drop below shoulders mid-hold', () => {
    const frames = buildFrames(
      (tMs): WarriorOnePoseIntent => {
        const intoHold = tMs - HOLD_START;
        // 3s clean (arms overhead) then arms drop to the sides.
        const armsRaised = intoHold < 3000;
        return { frontKneeFlexionDeg: 90, armsRaised };
      },
      buildWarriorOnePose,
      { fps: 30, durationMs: HOLD_START + 6000 },
    );
    const result = runWarriorOneSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'arms-not-overhead')).toBeGreaterThan(0);
    expect(result.broken).toBe(false);  // recoverable, not terminal
  });

  it('does NOT fire arms-not-overhead on a clean hold (arms stay overhead)', () => {
    const frames = buildFrames(
      () => ({ frontKneeFlexionDeg: 90, armsRaised: true } as WarriorOnePoseIntent),
      buildWarriorOnePose,
      { fps: 30, durationMs: HOLD_START + 5000 },
    );
    const result = runWarriorOneSession(frames);
    expect(countWarnings(result, 'arms-not-overhead')).toBe(0);
  });

  it('freezes the hold counter during a sustained arms-dropped period', () => {
    const frames = buildFrames(
      (tMs): WarriorOnePoseIntent => {
        const intoHold = tMs - HOLD_START;
        // Clean 0-8s, arms dropped 8-13s, clean again 13-18s.
        const armsRaised = intoHold < 8000 || intoHold >= 13_000;
        return { frontKneeFlexionDeg: 90, armsRaised };
      },
      buildWarriorOnePose,
      { fps: 30, durationMs: HOLD_START + 18_000 },
    );
    const result = runWarriorOneSession(frames);
    expect(result.broken).toBe(false);
    expect(countWarnings(result, 'arms-not-overhead')).toBeGreaterThan(0);
    const lastTick = result.holdTicks[result.holdTicks.length - 1];
    // 18s wall-clock minus ~5s frozen → ~13s valid.
    expect(lastTick.secondsElapsed).toBeLessThanOrEqual(15);
    expect(lastTick.secondsElapsed).toBeGreaterThanOrEqual(11);
  });
});
