import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildLungePose } from '../../harness/pose-stub';
import { runWalkingLungeSession, countWarnings } from '../../harness/runner';
import type { LungePoseIntent } from '../../harness/types';

const CAL_MS = 2200;

function makeFrames(repCycle: (tInRep: number, repIndex: number) => Partial<LungePoseIntent>, reps: number, repCycleMs: number) {
  return buildFrames(
    (tMs) => {
      if (tMs < CAL_MS) return { kneeFlexionDeg: 0, frontLeg: 'left' as const, armsAtSides: true } as LungePoseIntent;
      const repIndex = Math.floor((tMs - CAL_MS) / repCycleMs);
      const tInRep = (tMs - CAL_MS) % repCycleMs;
      return {
        kneeFlexionDeg: 0,
        frontLeg: (repIndex % 2 === 0 ? 'left' : 'right') as 'left' | 'right',
        armsAtSides: false,
        ...repCycle(tInRep, repIndex),
      } as LungePoseIntent;
    },
    buildLungePose,
    { fps: 30, durationMs: CAL_MS + reps * repCycleMs + 500 },
  );
}

describe('Walking Lunge — rep validation gates', () => {
  it('rejects shallow steps (peak < MIN_REP_DEPTH=50°)', () => {
    const frames = makeFrames(
      (t) => {
        let flex: number;
        if (t < 1000) flex = (t / 1000) * 35;
        else if (t < 1500) flex = 35;
        else if (t < 2500) flex = 35 - ((t - 1500) / 1000) * 35;
        else flex = 0;
        return { kneeFlexionDeg: flex };
      },
      5,
      3000,
    );
    const result = runWalkingLungeSession(frames);
    expect(result.completedReps.length).toBe(0);
    expect(countWarnings(result, 'incomplete-walking-lunge')).toBeGreaterThan(0);
  });

  it('rejects bilateral-squat imposters (both legs bend equally — gap < 15°)', () => {
    // Both legs flex to 90° identically — that's a squat, not a walking lunge.
    // Engine should reject via the front-back gap gate (gap < 15°).
    const frames = makeFrames(
      (t) => {
        let flex: number;
        if (t < 1000) flex = (t / 1000) * 90;
        else if (t < 1500) flex = 90;
        else if (t < 2500) flex = 90 - ((t - 1500) / 1000) * 90;
        else flex = 0;
        return { kneeFlexionDeg: flex, backLegFlexionDeg: flex };
      },
      3,
      3000,
    );
    const result = runWalkingLungeSession(frames);
    expect(result.completedReps.length).toBe(0);
    expect(countWarnings(result, 'malformed-rep')).toBeGreaterThan(0);
  });

  it('accepts a valid step at the minimum-depth boundary (55° front + back straight)', () => {
    const frames = makeFrames(
      (t) => {
        let flex: number;
        if (t < 800) flex = (t / 800) * 55;
        else if (t < 1200) flex = 55;
        else if (t < 2000) flex = 55 - ((t - 1200) / 800) * 55;
        else flex = 0;
        return { kneeFlexionDeg: flex, backLegFlexionDeg: 0 };
      },
      3,
      2500,
    );
    const result = runWalkingLungeSession(frames);
    expect(result.completedReps.length).toBe(3);
  });
});
