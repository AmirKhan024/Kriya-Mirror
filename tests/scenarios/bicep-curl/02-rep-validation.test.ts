import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildBicepCurlPose } from '../../harness/pose-stub';
import { runBicepCurlSession, countWarnings } from '../../harness/runner';
import type { BicepCurlPoseIntent } from '../../harness/types';

const CAL_MS = 2200;

function makeFrames(repCycle: (tInRep: number) => Partial<BicepCurlPoseIntent>, reps: number, repCycleMs: number) {
  return buildFrames(
    (tMs) => {
      if (tMs < CAL_MS) return { elbowFlexionDeg: 0 } as BicepCurlPoseIntent;
      const tInRep = (tMs - CAL_MS) % repCycleMs;
      return { elbowFlexionDeg: 0, ...repCycle(tInRep) } as BicepCurlPoseIntent;
    },
    buildBicepCurlPose,
    { fps: 30, durationMs: CAL_MS + reps * repCycleMs + 500 },
  );
}

describe('Bicep Curl — rep validation gates', () => {
  it('rejects shallow reps (peak < MIN_REP_DEPTH_DEG=90°)', () => {
    // Peak input flex 65° → even with EMA catch-up the smoothed peak stays
    // well below 90°.
    const frames = makeFrames(
      (t) => {
        let flex: number;
        if (t < 1000) flex = (t / 1000) * 65;
        else if (t < 1500) flex = 65;
        else if (t < 2500) flex = 65 - ((t - 1500) / 1000) * 65;
        else flex = 0;
        return { elbowFlexionDeg: flex };
      },
      5,
      3000,
    );
    const result = runBicepCurlSession(frames);
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
    const result = runBicepCurlSession(frames);
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
    const result = runBicepCurlSession(frames);
    expect(result.completedReps.length).toBe(3);
  });
});
