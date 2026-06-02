/**
 * Idle `not-moving` prompt for Warrior III: fires when form has been broken
 * (out of the T) for ≥ 5 s; repeats every 15 s; does not fire on a clean hold.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildWarrior3Pose } from '../../harness/pose-stub';
import { runWarrior3Session, countWarnings } from '../../harness/runner';
import type { Warrior3PoseIntent } from '../../harness/types';

const CAL_MS = 2200;
const HOLD_START = CAL_MS;

describe('Warrior III — not-moving idle prompt', () => {
  it('fires not-moving after ~5 s of sustained form-break (torso up)', () => {
    const frames = buildFrames(
      (tMs): Warrior3PoseIntent => {
        const intoHold = tMs - HOLD_START;
        const torso = intoHold < 1000 ? 10 : 60;
        return { torsoPitchFromHorizontalDeg: torso, backLegAngleFromHorizontalDeg: 10 };
      },
      buildWarrior3Pose,
      { fps: 30, durationMs: HOLD_START + 10_000 },
    );
    const result = runWarrior3Session(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'not-moving')).toBeGreaterThan(0);
  });

  it('does NOT fire not-moving on a clean hold', () => {
    const frames = buildFrames(
      () => ({ torsoPitchFromHorizontalDeg: 10, backLegAngleFromHorizontalDeg: 10 } as Warrior3PoseIntent),
      buildWarrior3Pose,
      { fps: 30, durationMs: HOLD_START + 10_000 },
    );
    const result = runWarrior3Session(frames);
    expect(countWarnings(result, 'not-moving')).toBe(0);
  });
});
