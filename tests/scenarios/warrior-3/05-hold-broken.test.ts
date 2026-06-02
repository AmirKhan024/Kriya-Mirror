/**
 * Fix S split — only the user standing fully back up (shoulder rise ≥ 15%)
 * terminates the hold. Form warnings freeze the timer but don't terminate.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildWarrior3Pose } from '../../harness/pose-stub';
import { runWarrior3Session, countWarnings } from '../../harness/runner';
import type { Warrior3PoseIntent } from '../../harness/types';

const CAL_MS = 2200;
const HOLD_START = CAL_MS;

describe('Warrior III — hold-broken (Fix S terminal split)', () => {
  it('terminates ONCE when the user stands fully up (shoulder rise ≥ 15%)', () => {
    const frames = buildFrames(
      (tMs): Warrior3PoseIntent => {
        const intoHold = tMs - HOLD_START;
        const shoulderRise = intoHold < 4000 ? 0 : 0.22;
        return { torsoPitchFromHorizontalDeg: 10, backLegAngleFromHorizontalDeg: 10, shoulderRise };
      },
      buildWarrior3Pose,
      { fps: 30, durationMs: HOLD_START + 8000 },
    );
    const result = runWarrior3Session(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.broken).toBe(true);
    expect(result.brokenAtMs).not.toBeNull();
    expect(countWarnings(result, 'hold-broken')).toBeGreaterThanOrEqual(1);
  });

  it('does NOT terminate on a brief shoulder-rise wobble (< debounce window)', () => {
    const frames = buildFrames(
      (tMs): Warrior3PoseIntent => {
        const intoHold = tMs - HOLD_START;
        // A ~250 ms wobble (≈ 8 frames < 12-frame debounce) then settle back.
        const wobble = intoHold >= 3000 && intoHold < 3250;
        return { torsoPitchFromHorizontalDeg: 10, backLegAngleFromHorizontalDeg: 10, shoulderRise: wobble ? 0.22 : 0 };
      },
      buildWarrior3Pose,
      { fps: 30, durationMs: HOLD_START + 8000 },
    );
    const result = runWarrior3Session(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.broken).toBe(false);
    expect(countWarnings(result, 'hold-broken')).toBe(0);
  });

  it('does NOT terminate on torso-not-level alone (Fix S recoverable)', () => {
    const frames = buildFrames(
      (tMs): Warrior3PoseIntent => {
        const intoHold = tMs - HOLD_START;
        const torso = intoHold < 3000 ? 10 : 60;
        return { torsoPitchFromHorizontalDeg: torso, backLegAngleFromHorizontalDeg: 10 };
      },
      buildWarrior3Pose,
      { fps: 30, durationMs: HOLD_START + 8000 },
    );
    const result = runWarrior3Session(frames);
    expect(result.broken).toBe(false);
    expect(countWarnings(result, 'torso-not-level')).toBeGreaterThan(0);
    expect(countWarnings(result, 'hold-broken')).toBe(0);
  });

  it('does NOT terminate on back-leg-low alone (Fix S recoverable)', () => {
    const frames = buildFrames(
      (tMs): Warrior3PoseIntent => {
        const intoHold = tMs - HOLD_START;
        const backLeg = intoHold < 3000 ? 10 : 70;
        return { torsoPitchFromHorizontalDeg: 10, backLegAngleFromHorizontalDeg: backLeg };
      },
      buildWarrior3Pose,
      { fps: 30, durationMs: HOLD_START + 8000 },
    );
    const result = runWarrior3Session(frames);
    expect(result.broken).toBe(false);
    expect(countWarnings(result, 'back-leg-low')).toBeGreaterThan(0);
    expect(countWarnings(result, 'hold-broken')).toBe(0);
  });
});
