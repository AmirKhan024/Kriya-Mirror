/**
 * 2026-05-28 round 21 regression: re-architected from polar-angle direction
 * tracking to bilateral overhead abduction. Direction (forward/backward) is
 * now instructional metadata, not engine state — engine just counts overhead
 * sweeps. Test renamed to verify the new overhead-required behaviour.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildArmCirclesPose } from '../../harness/pose-stub';
import { runArmCirclesSession, countWarnings } from '../../harness/runner';
import type { ArmCirclesPoseIntent } from '../../harness/types';

const CAL_MS = 2200;

describe('Arm Circles — overhead requirement (round 21 re-architecture)', () => {
  it('rejects reps that only reach shoulder height (~95° peak — lateral raise zone)', () => {
    const repCycleMs = 2800;
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) return { abductionDeg: 0 } as ArmCirclesPoseIntent;
        const t = (tMs - CAL_MS) % repCycleMs;
        let abd: number;
        if (t < 900) abd = (t / 900) * 95;
        else if (t < 1500) abd = 95;
        else if (t < 2700) abd = 95 - ((t - 1500) / 1200) * 95;
        else abd = 0;
        return { abductionDeg: abd } as ArmCirclesPoseIntent;
      },
      buildArmCirclesPose,
      { fps: 30, durationMs: CAL_MS + 3 * repCycleMs },
    );

    const result = runArmCirclesSession(frames);
    expect(result.completedReps.length).toBe(0);
    expect(countWarnings(result, 'incomplete-raise')).toBeGreaterThan(0);
  });

  it('accepts reps that reach near-vertical overhead (~170° peak)', () => {
    const repCycleMs = 3000;
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) return { abductionDeg: 0 } as ArmCirclesPoseIntent;
        const t = (tMs - CAL_MS) % repCycleMs;
        let abd: number;
        if (t < 900) abd = (t / 900) * 170;
        else if (t < 1500) abd = 170;
        else if (t < 2700) abd = 170 - ((t - 1500) / 1200) * 170;
        else abd = 0;
        return { abductionDeg: abd } as ArmCirclesPoseIntent;
      },
      buildArmCirclesPose,
      { fps: 30, durationMs: CAL_MS + 4 * repCycleMs },
    );

    const result = runArmCirclesSession(frames);
    expect(result.completedReps.length).toBeGreaterThanOrEqual(3);
  });
});
