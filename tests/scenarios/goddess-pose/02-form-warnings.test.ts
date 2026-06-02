/**
 * Goddess Pose's five form warnings. All recoverable per Fix S — they
 * freeze the timer, fire a warning, but do NOT terminate the workout.
 *
 * Warnings exercised (in the order the engine reports them):
 *   1. knees-caving         (NEW — bilateral valgus)
 *   2. arms-dropped         (NEW — cactus broken)
 *   3. knee-too-straight    (reused from chair-pose — both knees not deep enough)
 *   4. knee-too-deep        (reused from chair-pose — sunk past goddess)
 *   5. torso-too-forward    (reused from chair-pose — trunk leaning forward)
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildGoddessPosePose } from '../../harness/pose-stub';
import { runGoddessPoseSession, countWarnings } from '../../harness/runner';
import type { GoddessPosePoseIntent } from '../../harness/types';

const CAL_MS = 2200;
const HOLD_START = CAL_MS;

describe('Goddess Pose — form warnings (Fix S recoverable)', () => {
  it('fires knees-caving when knee X separation collapses below 75% of ankle separation', () => {
    const frames = buildFrames(
      (tMs): GoddessPosePoseIntent => {
        const intoHold = tMs - HOLD_START;
        // Clean 5s, then bilateral valgus (kneeAnkleRatio drops to 0.5).
        const ratio = intoHold < 5000 ? 1.0 : 0.5;
        return { kneeFlexionDeg: 90, kneeAnkleRatio: ratio };
      },
      buildGoddessPosePose,
      { fps: 30, durationMs: HOLD_START + 8000 },
    );
    const result = runGoddessPoseSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'knees-caving')).toBeGreaterThan(0);
    expect(result.broken).toBe(false);
  });

  it('fires arms-dropped when elbows fall well below shoulder height', () => {
    const frames = buildFrames(
      (tMs): GoddessPosePoseIntent => {
        const intoHold = tMs - HOLD_START;
        // Clean 5s, then elbows drop by 0.30 × shoulderWidth (well over threshold of 0.10).
        const drop = intoHold < 5000 ? 0 : 0.30;
        return { kneeFlexionDeg: 90, elbowDropFraction: drop };
      },
      buildGoddessPosePose,
      { fps: 30, durationMs: HOLD_START + 8000 },
    );
    const result = runGoddessPoseSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'arms-dropped')).toBeGreaterThan(0);
    expect(result.broken).toBe(false);
  });

  it('fires knee-too-straight when both knees rise above 70°', () => {
    const frames = buildFrames(
      (tMs): GoddessPosePoseIntent => {
        const intoHold = tMs - HOLD_START;
        // Clean 5s, then knees straighten to 50° (below 70° threshold).
        const flex = intoHold < 5000 ? 90 : 50;
        return { kneeFlexionDeg: flex };
      },
      buildGoddessPosePose,
      { fps: 30, durationMs: HOLD_START + 8000 },
    );
    const result = runGoddessPoseSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'knee-too-straight')).toBeGreaterThan(0);
    expect(result.broken).toBe(false);
  });

  it('fires knee-too-deep when both knees sink past 115°', () => {
    const frames = buildFrames(
      (tMs): GoddessPosePoseIntent => {
        const intoHold = tMs - HOLD_START;
        const flex = intoHold < 5000 ? 90 : 135;
        return { kneeFlexionDeg: flex };
      },
      buildGoddessPosePose,
      { fps: 30, durationMs: HOLD_START + 8000 },
    );
    const result = runGoddessPoseSession(frames);
    expect(countWarnings(result, 'knee-too-deep')).toBeGreaterThan(0);
    expect(result.broken).toBe(false);
  });

  it('fires torso-too-forward when trunk leans past 20° from vertical', () => {
    const frames = buildFrames(
      (tMs): GoddessPosePoseIntent => {
        const intoHold = tMs - HOLD_START;
        const lean = intoHold < 5000 ? 0 : 35;
        return { kneeFlexionDeg: 90, trunkLeanDeg: lean };
      },
      buildGoddessPosePose,
      { fps: 30, durationMs: HOLD_START + 8000 },
    );
    const result = runGoddessPoseSession(frames);
    expect(countWarnings(result, 'torso-too-forward')).toBeGreaterThan(0);
    expect(result.broken).toBe(false);
  });

  it('does NOT fire any form warning on clean continuous form (sanity)', () => {
    const frames = buildFrames(
      () => ({ kneeFlexionDeg: 90 } as GoddessPosePoseIntent),
      buildGoddessPosePose,
      { fps: 30, durationMs: HOLD_START + 8000 },
    );
    const result = runGoddessPoseSession(frames);
    expect(countWarnings(result, 'knees-caving')).toBe(0);
    expect(countWarnings(result, 'arms-dropped')).toBe(0);
    expect(countWarnings(result, 'knee-too-straight')).toBe(0);
    expect(countWarnings(result, 'knee-too-deep')).toBe(0);
    expect(countWarnings(result, 'torso-too-forward')).toBe(0);
  });
});
