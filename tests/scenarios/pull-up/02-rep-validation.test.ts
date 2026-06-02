import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildPullUpPose } from '../../harness/pose-stub';
import { runPullUpSession, countWarnings } from '../../harness/runner';
import type { PullUpPoseIntent } from '../../harness/types';

const CAL_MS = 2200;

function makeFrames(repCycle: (tInRep: number) => Partial<PullUpPoseIntent>, reps: number, repCycleMs: number) {
  return buildFrames(
    (tMs) => {
      if (tMs < CAL_MS) return { elbowFlexionDeg: 0 } as PullUpPoseIntent;
      const tInRep = (tMs - CAL_MS) % repCycleMs;
      return { elbowFlexionDeg: 0, ...repCycle(tInRep) } as PullUpPoseIntent;
    },
    buildPullUpPose,
    { fps: 30, durationMs: CAL_MS + reps * repCycleMs + 500 },
  );
}

describe('Pull-Up — rep validation gates', () => {
  it('rejects shallow reps (peak < MIN_REP_DEPTH_DEG=90°)', () => {
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
    const result = runPullUpSession(frames);
    expect(result.completedReps.length).toBe(0);
    expect(countWarnings(result, 'incomplete-pullup')).toBeGreaterThan(0);
  });

  it('rejects unilateral reps (only right arm pulls)', () => {
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
    const result = runPullUpSession(frames);
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
    const result = runPullUpSession(frames);
    expect(result.completedReps.length).toBe(3);
  });

  it('does not count a rep that is too fast to stabilize at top (8-frame AT_TOP threshold)', () => {
    // 300ms rep: 100ms up → 100ms hold → 100ms down.
    // 100ms hold = only ~3 frames at 30fps, which is below TOP_STABILITY_FRAMES=8.
    // The state machine never exits PULLING → rep is silently ignored (not counted).
    const frames = makeFrames(
      (t) => {
        let flex: number;
        if (t < 100) flex = (t / 100) * 130;
        else if (t < 200) flex = 130;
        else if (t < 300) flex = 130 - ((t - 200) / 100) * 130;
        else flex = 0;
        return { elbowFlexionDeg: flex };
      },
      3,
      1000,
    );
    const result = runPullUpSession(frames);
    expect(result.completedReps.length).toBe(0);
  });
});
