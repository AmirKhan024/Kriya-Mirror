import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildSquatPose } from '../../harness/pose-stub';
import { runSquatSession, countWarnings } from '../../harness/runner';
import type { SquatPoseIntent } from '../../harness/types';

const CAL_MS = 2200;
const BASE_INTENT: Partial<SquatPoseIntent> = {
  feetWidthRatio: 1.25,
  armsOverhead: true,
};

function makeFrames(repCycle: (tInRep: number) => Partial<SquatPoseIntent>, reps: number, repCycleMs: number) {
  return buildFrames(
    (tMs) => {
      if (tMs < CAL_MS) return { ...BASE_INTENT, kneeFlexionDeg: 0 } as SquatPoseIntent;
      const tInRep = (tMs - CAL_MS) % repCycleMs;
      return { ...BASE_INTENT, armsOverhead: false, ...repCycle(tInRep) } as SquatPoseIntent;
    },
    buildSquatPose,
    { fps: 30, durationMs: CAL_MS + reps * repCycleMs + 500 },
  );
}

describe('Squat — rep validation gates', () => {
  it('rejects shallow reps (peak < 45° MIN_REP_DEPTH)', () => {
    // Five reps that only reach 35° depth. Engine should never enter rep counting
    // (DESCEND_START is 25°, but the rep validates against MIN_REP_DEPTH=45 on completion).
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
    const result = runSquatSession(frames);
    expect(result.completedReps.length).toBe(0);
  });

  it('rejects ballistic reps (descend + ascend in < 300 ms)', () => {
    // Bounce up and down very fast at 100° depth. Each rep cycle is 200ms total.
    const frames = makeFrames(
      (t) => {
        let flex: number;
        if (t < 100) flex = (t / 100) * 100;
        else if (t < 200) flex = 100 - ((t - 100) / 100) * 100;
        else flex = 0;
        return { kneeFlexionDeg: flex };
      },
      5,
      900,
    );
    const result = runSquatSession(frames);
    expect(result.completedReps.length).toBe(0);
    // At least one rep should have triggered the malformed-rep warning
    expect(countWarnings(result, 'malformed-rep')).toBeGreaterThan(0);
  });

  it('rejects unilateral reps (only left knee bends, right stays straight)', () => {
    const frames = makeFrames(
      (t) => {
        let flexL = 0;
        if (t < 1000) flexL = (t / 1000) * 100;
        else if (t < 1500) flexL = 100;
        else if (t < 2500) flexL = 100 - ((t - 1500) / 1000) * 100;
        return { kneeFlexionDeg: 0, leftKneeFlexionDeg: flexL, rightKneeFlexionDeg: 0 };
      },
      3,
      3000,
    );
    const result = runSquatSession(frames);
    expect(result.completedReps.length).toBe(0);
  });

  it('accepts a valid rep at the minimum-depth boundary (50° + 800 ms)', () => {
    const frames = makeFrames(
      (t) => {
        let flex: number;
        if (t < 800) flex = (t / 800) * 50;
        else if (t < 1200) flex = 50;
        else if (t < 2000) flex = 50 - ((t - 1200) / 800) * 50;
        else flex = 0;
        return { kneeFlexionDeg: flex };
      },
      3,
      2500,
    );
    const result = runSquatSession(frames);
    expect(result.completedReps.length).toBe(3);
  });
});
