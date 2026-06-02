/**
 * Warrior III's three form warnings — all recoverable per Fix S (they freeze
 * the timer + warn, but do NOT terminate the hold).
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildWarrior3Pose } from '../../harness/pose-stub';
import { runWarrior3Session, countWarnings } from '../../harness/runner';
import type { Warrior3PoseIntent } from '../../harness/types';

const CAL_MS = 2200;
const HOLD_START = CAL_MS;

describe('Warrior III — form warnings (Fix S recoverable)', () => {
  it('fires torso-not-level when the torso comes up out of the T', () => {
    const frames = buildFrames(
      (tMs): Warrior3PoseIntent => {
        const intoHold = tMs - HOLD_START;
        const torso = intoHold < 5000 ? 10 : 60;   // hinge → upright
        return { torsoPitchFromHorizontalDeg: torso, backLegAngleFromHorizontalDeg: 10, standingKneeFlexionDeg: 5 };
      },
      buildWarrior3Pose,
      { fps: 30, durationMs: HOLD_START + 9000 },
    );
    const result = runWarrior3Session(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'torso-not-level')).toBeGreaterThan(0);
    expect(result.broken).toBe(false);
  });

  it('fires back-leg-low when the back leg drops toward the floor', () => {
    const frames = buildFrames(
      (tMs): Warrior3PoseIntent => {
        const intoHold = tMs - HOLD_START;
        const backLeg = intoHold < 5000 ? 10 : 70;
        return { torsoPitchFromHorizontalDeg: 10, backLegAngleFromHorizontalDeg: backLeg, standingKneeFlexionDeg: 5 };
      },
      buildWarrior3Pose,
      { fps: 30, durationMs: HOLD_START + 9000 },
    );
    const result = runWarrior3Session(frames);
    expect(countWarnings(result, 'back-leg-low')).toBeGreaterThan(0);
    expect(result.broken).toBe(false);
  });

  it('fires leg-not-straight when the standing knee bends', () => {
    const frames = buildFrames(
      (tMs): Warrior3PoseIntent => {
        const intoHold = tMs - HOLD_START;
        const knee = intoHold < 5000 ? 5 : 45;
        return { torsoPitchFromHorizontalDeg: 10, backLegAngleFromHorizontalDeg: 10, standingKneeFlexionDeg: knee };
      },
      buildWarrior3Pose,
      { fps: 30, durationMs: HOLD_START + 9000 },
    );
    const result = runWarrior3Session(frames);
    expect(countWarnings(result, 'leg-not-straight')).toBeGreaterThan(0);
    expect(result.broken).toBe(false);
  });

  it('does NOT fire any form warning on a clean hold (sanity)', () => {
    const frames = buildFrames(
      () => ({ torsoPitchFromHorizontalDeg: 10, backLegAngleFromHorizontalDeg: 10, standingKneeFlexionDeg: 5 } as Warrior3PoseIntent),
      buildWarrior3Pose,
      { fps: 30, durationMs: HOLD_START + 8000 },
    );
    const result = runWarrior3Session(frames);
    expect(countWarnings(result, 'torso-not-level')).toBe(0);
    expect(countWarnings(result, 'back-leg-low')).toBe(0);
    expect(countWarnings(result, 'leg-not-straight')).toBe(0);
  });
});
