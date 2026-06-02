import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildLateralLungePose } from '../../harness/pose-stub';
import { runLateralLungeSession, countWarnings } from '../../harness/runner';
import type { LateralLungePoseIntent } from '../../harness/types';

const CAL_MS = 2200;

function makeFrames(
  repCycle: (tInRep: number, repIndex: number) => Partial<LateralLungePoseIntent>,
  reps: number,
  repCycleMs: number,
) {
  return buildFrames(
    (tMs): LateralLungePoseIntent => {
      if (tMs < CAL_MS) return { workingKneeFlexionDeg: 0, workingSide: 'left', lateralShift: 0, armsAtSides: true };
      const repIndex = Math.floor((tMs - CAL_MS) / repCycleMs);
      const tInRep = (tMs - CAL_MS) % repCycleMs;
      return {
        workingKneeFlexionDeg: 0,
        workingSide: repIndex % 2 === 0 ? 'left' : 'right',
        lateralShift: 0,
        armsAtSides: true,
        ...repCycle(tInRep, repIndex),
      };
    },
    buildLateralLungePose,
    { fps: 30, durationMs: CAL_MS + reps * repCycleMs + 500 },
  );
}

describe('Lateral Lunge — rep validation gates', () => {
  it('rejects shallow reps (peak < MIN_REP_DEPTH=50°)', () => {
    const frames = makeFrames(
      (t) => {
        let flex: number;
        if (t < 1000) flex = (t / 1000) * 35;
        else if (t < 1500) flex = 35;
        else if (t < 2500) flex = 35 - ((t - 1500) / 1000) * 35;
        else flex = 0;
        return { workingKneeFlexionDeg: flex, lateralShift: (flex / 35) * 0.14 };
      },
      5,
      3000,
    );
    const result = runLateralLungeSession(frames);
    expect(result.completedReps.length).toBe(0);
    expect(countWarnings(result, 'incomplete-lunge')).toBeGreaterThan(0);
  });

  it('rejects a stationary knee-bend with no lateral weight shift', () => {
    // Deep working-knee flex but the foot never steps out (lateralShift = 0) →
    // the pelvis does not move toward the working side → no-lateral-shift reject.
    const frames = makeFrames(
      (t) => {
        let flex: number;
        if (t < 1000) flex = (t / 1000) * 90;
        else if (t < 1500) flex = 90;
        else if (t < 2500) flex = 90 - ((t - 1500) / 1000) * 90;
        else flex = 0;
        return { workingKneeFlexionDeg: flex, lateralShift: 0 };
      },
      3,
      3000,
    );
    const result = runLateralLungeSession(frames);
    expect(result.completedReps.length).toBe(0);
    expect(countWarnings(result, 'malformed-rep')).toBeGreaterThan(0);
  });

  it('accepts a valid rep at the minimum-depth boundary (55° working + shift)', () => {
    const frames = makeFrames(
      (t) => {
        let flex: number;
        if (t < 800) flex = (t / 800) * 55;
        else if (t < 1200) flex = 55;
        else if (t < 2000) flex = 55 - ((t - 1200) / 800) * 55;
        else flex = 0;
        return { workingKneeFlexionDeg: flex, lateralShift: (flex / 55) * 0.14 };
      },
      3,
      2500,
    );
    const result = runLateralLungeSession(frames);
    expect(result.completedReps.length).toBe(3);
  });
});
