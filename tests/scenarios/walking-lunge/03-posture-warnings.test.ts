import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildLungePose } from '../../harness/pose-stub';
import { runWalkingLungeSession, countWarnings } from '../../harness/runner';
import type { LungePoseIntent } from '../../harness/types';

const CAL_MS = 2200;

function makeFrames(repCycle: (tInRep: number) => Partial<LungePoseIntent>, reps = 3, repCycleMs = 3000) {
  return buildFrames(
    (tMs) => {
      if (tMs < CAL_MS) return { kneeFlexionDeg: 0, frontLeg: 'left' as const, armsAtSides: true } as LungePoseIntent;
      const repIndex = Math.floor((tMs - CAL_MS) / repCycleMs);
      const tInRep = (tMs - CAL_MS) % repCycleMs;
      return {
        kneeFlexionDeg: 0,
        frontLeg: (repIndex % 2 === 0 ? 'left' : 'right') as 'left' | 'right',
        armsAtSides: false,
        ...repCycle(tInRep),
      } as LungePoseIntent;
    },
    buildLungePose,
    { fps: 30, durationMs: CAL_MS + reps * repCycleMs + 500 },
  );
}

function repFlex(t: number, peak = 90): number {
  if (t < 1000) return (t / 1000) * peak;
  if (t < 1500) return peak;
  if (t < 2500) return peak - ((t - 1500) / 1000) * peak;
  return 0;
}

describe('Walking Lunge — posture warnings', () => {
  it('fires trunk-forward warning when trunk leans past 55°', () => {
    const frames = makeFrames((t) => {
      const flex = repFlex(t);
      const trunkLeanDeg = flex > 60 ? 65 : 0;
      return { kneeFlexionDeg: flex, trunkLeanDeg };
    }, 2);
    const result = runWalkingLungeSession(frames);
    expect(countWarnings(result, 'trunk-forward')).toBeGreaterThan(0);
  });

  it('does NOT fire any posture warnings on clean steps (sanity)', () => {
    const frames = makeFrames((t) => ({ kneeFlexionDeg: repFlex(t) }), 3);
    const result = runWalkingLungeSession(frames);
    expect(countWarnings(result, 'valgus')).toBe(0);
    expect(countWarnings(result, 'trunk-forward')).toBe(0);
    expect(countWarnings(result, 'knee-past-toe')).toBe(0);
    expect(countWarnings(result, 'incomplete-walking-lunge')).toBe(0);
  });

  it('does NOT fire knee-past-toe (disabled in front-camera mode)', () => {
    // knee-past-toe requires a side camera (depth axis). The front-camera engine
    // explicitly does not emit this warning — this guards against regressions
    // where someone re-enables detection without a proper 3D-aware metric.
    const frames = makeFrames((t) => ({ kneeFlexionDeg: repFlex(t, 95) }), 3);
    const result = runWalkingLungeSession(frames);
    expect(countWarnings(result, 'knee-past-toe')).toBe(0);
  });
});
