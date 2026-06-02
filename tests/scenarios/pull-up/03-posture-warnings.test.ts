import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildPullUpPose } from '../../harness/pose-stub';
import { runPullUpSession, countWarnings } from '../../harness/runner';
import type { PullUpPoseIntent } from '../../harness/types';

const CAL_MS = 2200;

function makeFrames(repCycle: (tInRep: number) => Partial<PullUpPoseIntent>, reps = 3, repCycleMs = 3000) {
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

function repFlex(t: number, peak = 130): number {
  if (t < 1000) return (t / 1000) * peak;
  if (t < 1500) return peak;
  if (t < 2500) return peak - ((t - 1500) / 1000) * peak;
  return 0;
}

describe('Pull-Up — posture warnings', () => {
  it('fires shoulder-shrug warning when ear-shoulder gap collapses during pull', () => {
    const frames = makeFrames((t) => {
      const flex = repFlex(t);
      // Sustained shrug (gap 0.02, threshold 0.075) during active phase
      const shrugAmount = flex > 30 ? 0.08 : 0;
      return { elbowFlexionDeg: flex, shrugAmount };
    }, 3);
    const result = runPullUpSession(frames);
    expect(countWarnings(result, 'shoulder-shrug')).toBeGreaterThan(0);
  });

  it('fires malformed-rep warning when kipping (hip X drift > 0.06)', () => {
    const frames = makeFrames((t) => {
      const flex = repFlex(t);
      // Sustained hip swing of 0.08 (> HIP_SWING_THRESHOLD 0.06) during active phase
      const hipSwingX = flex > 30 ? 0.08 : 0;
      return { elbowFlexionDeg: flex, hipSwingX };
    }, 3);
    const result = runPullUpSession(frames);
    // Kipping rejects the rep and fires malformed-rep
    expect(countWarnings(result, 'malformed-rep')).toBeGreaterThan(0);
  });

  it('does NOT fire any posture warnings on clean reps (sanity)', () => {
    const frames = makeFrames((t) => ({ elbowFlexionDeg: repFlex(t) }), 3);
    const result = runPullUpSession(frames);
    expect(countWarnings(result, 'shoulder-shrug')).toBe(0);
    expect(countWarnings(result, 'incomplete-pullup')).toBe(0);
  });

  it('momentary shrug (4 frames) does NOT trigger a warning (below debounce threshold=8)', () => {
    const frames = makeFrames((t) => {
      const flex = repFlex(t);
      // 4-frame spike (~133 ms at 30 fps) — below SHOULDER_SHRUG_DEBOUNCE_FRAMES=8
      const shrugAmount = t >= 1200 && t <= 1320 ? 0.08 : 0;
      return { elbowFlexionDeg: flex, shrugAmount };
    }, 2);
    const result = runPullUpSession(frames);
    expect(countWarnings(result, 'shoulder-shrug')).toBe(0);
  });
});
