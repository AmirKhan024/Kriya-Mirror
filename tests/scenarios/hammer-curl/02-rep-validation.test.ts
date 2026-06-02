import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildHammerCurlPose } from '../../harness/pose-stub';
import { runHammerCurlSession, countWarnings } from '../../harness/runner';
import type { HammerCurlPoseIntent } from '../../harness/types';

const CAL_MS = 2200;

function makeFrames(repCycle: (tInRep: number) => Partial<HammerCurlPoseIntent>, reps: number, repCycleMs: number) {
  return buildFrames(
    (tMs) => {
      if (tMs < CAL_MS) return { elbowFlexionDeg: 0 } as HammerCurlPoseIntent;
      const tInRep = (tMs - CAL_MS) % repCycleMs;
      return { elbowFlexionDeg: 0, ...repCycle(tInRep) } as HammerCurlPoseIntent;
    },
    buildHammerCurlPose,
    { fps: 30, durationMs: CAL_MS + reps * repCycleMs + 500 },
  );
}

describe('Hammer Curl — rep validation gates', () => {
  it('rejects shallow reps (peak < MIN_REP_DEPTH_DEG=85°)', () => {
    // Peak input flex 60° — well below the 85° minimum
    const frames = makeFrames(
      (t) => {
        let flex: number;
        if (t < 1000) flex = (t / 1000) * 60;
        else if (t < 1500) flex = 60;
        else if (t < 2500) flex = 60 - ((t - 1500) / 1000) * 60;
        else flex = 0;
        return { elbowFlexionDeg: flex };
      },
      5,
      3000,
    );
    const result = runHammerCurlSession(frames);
    expect(result.completedReps.length).toBe(0);
    expect(countWarnings(result, 'incomplete-curl')).toBeGreaterThan(0);
  });

  it('rejects unilateral reps (only right arm curls)', () => {
    const frames = makeFrames(
      (t) => {
        let flex: number;
        if (t < 1000) flex = (t / 1000) * 130;
        else if (t < 1500) flex = 130;
        else if (t < 2500) flex = 130 - ((t - 1500) / 1000) * 130;
        else flex = 0;
        return { elbowFlexionDeg: 0, leftElbowFlexionDeg: 0, rightElbowFlexionDeg: flex };
      },
      3,
      3000,
    );
    const result = runHammerCurlSession(frames);
    expect(result.completedReps.length).toBe(0);
  });

  it('accepts a valid rep at the minimum-depth boundary (95° + 1.5 s)', () => {
    const frames = makeFrames(
      (t) => {
        let flex: number;
        if (t < 800) flex = (t / 800) * 100;
        else if (t < 1200) flex = 100;
        else if (t < 2000) flex = 100 - ((t - 1200) / 800) * 100;
        else flex = 0;
        return { elbowFlexionDeg: flex };
      },
      3,
      2500,
    );
    const result = runHammerCurlSession(frames);
    expect(result.completedReps.length).toBe(3);
  });
});
