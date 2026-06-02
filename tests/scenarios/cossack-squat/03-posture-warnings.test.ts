import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildCossackSquatPose } from '../../harness/pose-stub';
import { runCossackSquatSession, countWarnings } from '../../harness/runner';
import type { CossackSquatPoseIntent } from '../../harness/types';

const CAL_MS = 2200;

function makeFrames(repCycle: (tInRep: number) => Partial<CossackSquatPoseIntent>, reps = 3, repCycleMs = 3000) {
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
        ...repCycle(tInRep),
      };
    },
    buildCossackSquatPose,
    { fps: 30, durationMs: CAL_MS + reps * repCycleMs + 500 },
  );
}

function repFlex(t: number, peak = 95): number {
  if (t < 1000) return (t / 1000) * peak;
  if (t < 1500) return peak;
  if (t < 2500) return peak - ((t - 1500) / 1000) * peak;
  return 0;
}

describe('Cossack Squat — posture warnings', () => {
  it('fires trunk-forward when the torso collapses past 55° during the rep', () => {
    const frames = makeFrames((t) => {
      const flex = repFlex(t);
      return {
        workingKneeFlexionDeg: flex,
        hipShift: (flex / 95) * 0.05,
        trunkLeanDeg: flex > 60 ? 65 : 0,
      };
    }, 2);
    const result = runCossackSquatSession(frames);
    expect(countWarnings(result, 'trunk-forward')).toBeGreaterThan(0);
  });

  it('fires leg-not-straight when the extended leg bends during the rep', () => {
    const frames = makeFrames((t) => {
      const flex = repFlex(t);
      return {
        workingKneeFlexionDeg: flex,
        hipShift: (flex / 95) * 0.05,
        // The "straight" leg bends ~halfway — still leaves a big working gap so
        // the rep can count, but the extended leg is clearly not straight.
        straightLegFlexionDeg: flex > 40 ? 45 : 5,
      };
    }, 2);
    const result = runCossackSquatSession(frames);
    expect(countWarnings(result, 'leg-not-straight')).toBeGreaterThan(0);
  });

  it('does NOT fire any posture warnings on clean reps (sanity)', () => {
    const frames = makeFrames((t) => {
      const flex = repFlex(t);
      return { workingKneeFlexionDeg: flex, hipShift: (flex / 95) * 0.05 };
    }, 3);
    const result = runCossackSquatSession(frames);
    expect(countWarnings(result, 'valgus')).toBe(0);
    expect(countWarnings(result, 'trunk-forward')).toBe(0);
    expect(countWarnings(result, 'leg-not-straight')).toBe(0);
    expect(countWarnings(result, 'incomplete-lunge')).toBe(0);
  });
});
