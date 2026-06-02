/**
 * Warrior II's three knee/trunk warnings. All recoverable per Fix S — they
 * freeze the timer, fire a warning, but do NOT terminate the workout.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildWarriorTwoPose } from '../../harness/pose-stub';
import { runWarriorTwoSession, countWarnings } from '../../harness/runner';
import type { WarriorTwoPoseIntent } from '../../harness/types';

const CAL_MS = 2200;
const HOLD_START = CAL_MS;

describe('Warrior II — knee + trunk form warnings (Fix S recoverable)', () => {
  it('fires front-knee-not-bent-enough when front knee straightens', () => {
    const frames = buildFrames(
      (tMs): WarriorTwoPoseIntent => {
        const intoHold = tMs - HOLD_START;
        // 2026-05-28 round 19: threshold dropped 70 → 50. Bad form now at 35°
        // (was 50°). Clean 90° hold, then clearly straighten to 35°.
        const flex = intoHold < 5000 ? 90 : 35;
        return { frontKneeFlexionDeg: flex };
      },
      buildWarriorTwoPose,
      { fps: 30, durationMs: HOLD_START + 8000 },
    );
    const result = runWarriorTwoSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'front-knee-not-bent-enough')).toBeGreaterThan(0);
    expect(result.broken).toBe(false);
  });

  it('fires front-knee-bent-too-much when front knee goes past 120°', () => {
    const frames = buildFrames(
      (tMs): WarriorTwoPoseIntent => {
        const intoHold = tMs - HOLD_START;
        const flex = intoHold < 5000 ? 90 : 135;
        return { frontKneeFlexionDeg: flex };
      },
      buildWarriorTwoPose,
      { fps: 30, durationMs: HOLD_START + 8000 },
    );
    const result = runWarriorTwoSession(frames);
    expect(countWarnings(result, 'front-knee-bent-too-much')).toBeGreaterThan(0);
    expect(result.broken).toBe(false);
  });

  it('fires back-knee-bent when back leg bends past 25°', () => {
    const frames = buildFrames(
      (tMs): WarriorTwoPoseIntent => {
        const intoHold = tMs - HOLD_START;
        const backFlex = intoHold < 5000 ? 5 : 40;
        return { frontKneeFlexionDeg: 90, backKneeFlexionDeg: backFlex };
      },
      buildWarriorTwoPose,
      { fps: 30, durationMs: HOLD_START + 8000 },
    );
    const result = runWarriorTwoSession(frames);
    expect(countWarnings(result, 'back-knee-bent')).toBeGreaterThan(0);
    expect(result.broken).toBe(false);
  });

  it('fires torso-too-forward when trunk leans past 25°', () => {
    const frames = buildFrames(
      (tMs): WarriorTwoPoseIntent => {
        const intoHold = tMs - HOLD_START;
        const lean = intoHold < 5000 ? 5 : 40;
        return { frontKneeFlexionDeg: 90, trunkLeanDeg: lean };
      },
      buildWarriorTwoPose,
      { fps: 30, durationMs: HOLD_START + 8000 },
    );
    const result = runWarriorTwoSession(frames);
    expect(countWarnings(result, 'torso-too-forward')).toBeGreaterThan(0);
    expect(result.broken).toBe(false);
  });

  it('does NOT fire any warning on clean continuous form (sanity)', () => {
    const frames = buildFrames(
      () => ({ frontKneeFlexionDeg: 90, backKneeFlexionDeg: 5, trunkLeanDeg: 5 } as WarriorTwoPoseIntent),
      buildWarriorTwoPose,
      { fps: 30, durationMs: HOLD_START + 8000 },
    );
    const result = runWarriorTwoSession(frames);
    expect(countWarnings(result, 'front-knee-not-bent-enough')).toBe(0);
    expect(countWarnings(result, 'front-knee-bent-too-much')).toBe(0);
    expect(countWarnings(result, 'back-knee-bent')).toBe(0);
    expect(countWarnings(result, 'torso-too-forward')).toBe(0);
  });

  // 2026-05-28 round 19 regression — physical test showed user holding at
  // ~60° front-knee flex (initialFrontKnee=63.8° in logs). Old threshold of
  // 70° fired immediately after cal. New threshold of 50° must accept 60°.
  it('accepts user holding at 60° front-knee flex without warnings', () => {
    const frames = buildFrames(
      () => ({ frontKneeFlexionDeg: 60, backKneeFlexionDeg: 5 } as WarriorTwoPoseIntent),
      buildWarriorTwoPose,
      { fps: 30, durationMs: HOLD_START + 10_000 },
    );
    const result = runWarriorTwoSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'front-knee-not-bent-enough')).toBe(0);
  });
});
