import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildCossackSquatPose } from '../../harness/pose-stub';
import { runCossackSquatSession, countWarnings } from '../../harness/runner';
import type { CossackSquatPoseIntent } from '../../harness/types';

const CAL_MS = 2200;

function makeFrames(
  repCycle: (tInRep: number, repIndex: number) => Partial<CossackSquatPoseIntent>,
  reps: number,
  repCycleMs: number,
) {
  return buildFrames(
    (tMs): CossackSquatPoseIntent => {
      if (tMs < CAL_MS) return { workingKneeFlexionDeg: 0, workingSide: 'left', hipShift: 0, feetWidthRatio: 1.8, armsAtSides: true };
      const repIndex = Math.floor((tMs - CAL_MS) / repCycleMs);
      const tInRep = (tMs - CAL_MS) % repCycleMs;
      return {
        workingKneeFlexionDeg: 0,
        workingSide: repIndex % 2 === 0 ? 'left' : 'right',
        hipShift: 0,
        feetWidthRatio: 1.8,
        armsAtSides: true,
        ...repCycle(tInRep, repIndex),
      };
    },
    buildCossackSquatPose,
    { fps: 30, durationMs: CAL_MS + reps * repCycleMs + 500 },
  );
}

describe('Cossack Squat — rep validation gates', () => {
  it('rejects shallow reps (peak working flex < MIN_REP_DEPTH=70°)', () => {
    const frames = makeFrames(
      (t) => {
        let flex: number;
        if (t < 1000) flex = (t / 1000) * 35;
        else if (t < 1500) flex = 35;
        else if (t < 2500) flex = 35 - ((t - 1500) / 1000) * 35;
        else flex = 0;
        return { workingKneeFlexionDeg: flex, hipShift: (flex / 35) * 0.05 };
      },
      5,
      3000,
    );
    const result = runCossackSquatSession(frames);
    expect(result.completedReps.length).toBe(0);
    expect(countWarnings(result, 'incomplete-lunge')).toBeGreaterThan(0);
  });

  it('rejects a deep knee-bend with no lateral weight shift (squat in place)', () => {
    const frames = makeFrames(
      (t) => {
        let flex: number;
        if (t < 1000) flex = (t / 1000) * 95;
        else if (t < 1500) flex = 95;
        else if (t < 2500) flex = 95 - ((t - 1500) / 1000) * 95;
        else flex = 0;
        return { workingKneeFlexionDeg: flex, hipShift: 0 };
      },
      3,
      3000,
    );
    const result = runCossackSquatSession(frames);
    expect(result.completedReps.length).toBe(0);
    expect(countWarnings(result, 'malformed-rep')).toBeGreaterThan(0);
  });
});
