/**
 * Fix B (wrong gets discarded) + Fix V (entry/exit hysteresis): sustained
 * bad-form periods freeze the accumulator. Final valid seconds < wall-clock.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildWarrior3Pose } from '../../harness/pose-stub';
import { runWarrior3Session, countWarnings } from '../../harness/runner';
import type { Warrior3PoseIntent } from '../../harness/types';

const CAL_MS = 2200;
const HOLD_START = CAL_MS;

describe('Warrior III — bad-form time is discarded (Fix B + Fix V)', () => {
  it('freezes the hold counter during a sustained torso-not-level break', () => {
    const frames = buildFrames(
      (tMs): Warrior3PoseIntent => {
        const intoHold = tMs - HOLD_START;
        // Clean 0-10s, torso comes up 10-15s, clean again 15-20s.
        const torso = (intoHold >= 10_000 && intoHold < 15_000) ? 60 : 10;
        return { torsoPitchFromHorizontalDeg: torso, backLegAngleFromHorizontalDeg: 10, standingKneeFlexionDeg: 5 };
      },
      buildWarrior3Pose,
      { fps: 30, durationMs: HOLD_START + 20_000 },
    );
    const result = runWarrior3Session(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.broken).toBe(false);
    expect(countWarnings(result, 'torso-not-level')).toBeGreaterThan(0);

    const lastTick = result.holdTicks[result.holdTicks.length - 1];
    // ~22s of hold with ~5s frozen → ~17s valid.
    expect(lastTick.secondsElapsed).toBeLessThanOrEqual(18);
    expect(lastTick.secondsElapsed).toBeGreaterThanOrEqual(12);
  });

  it('does NOT freeze on single-frame jitter (Fix V hysteresis)', () => {
    const frames = buildFrames(
      (tMs): Warrior3PoseIntent => {
        const intoHold = tMs - HOLD_START;
        const isBadFrame = intoHold > 0 && Math.floor(intoHold / 33) % 30 === 0;
        return { torsoPitchFromHorizontalDeg: isBadFrame ? 60 : 10, backLegAngleFromHorizontalDeg: 10, standingKneeFlexionDeg: 5 };
      },
      buildWarrior3Pose,
      { fps: 30, durationMs: HOLD_START + 10_000 },
    );
    const result = runWarrior3Session(frames);
    expect(countWarnings(result, 'torso-not-level')).toBe(0);
    const lastTick = result.holdTicks[result.holdTicks.length - 1];
    expect(lastTick.secondsElapsed).toBeGreaterThanOrEqual(9);
  });
});
