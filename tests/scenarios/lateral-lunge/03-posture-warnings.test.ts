import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildLateralLungePose } from '../../harness/pose-stub';
import { runLateralLungeSession, countWarnings } from '../../harness/runner';
import type { LateralLungePoseIntent } from '../../harness/types';

const CAL_MS = 2200;

function makeFrames(repCycle: (tInRep: number) => Partial<LateralLungePoseIntent>, reps = 3, repCycleMs = 3000) {
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
        ...repCycle(tInRep),
      };
    },
    buildLateralLungePose,
    { fps: 30, durationMs: CAL_MS + reps * repCycleMs + 500 },
  );
}

function repFlex(t: number, peak = 90): number {
  if (t < 1000) return (t / 1000) * peak;
  if (t < 1500) return peak;
  if (t < 2500) return peak - ((t - 1500) / 1000) * peak;
  return 0;
}

describe('Lateral Lunge — posture warnings', () => {
  it('fires trunk-forward when the torso collapses past 55° during the rep', () => {
    const frames = makeFrames((t) => {
      const flex = repFlex(t);
      return {
        workingKneeFlexionDeg: flex,
        lateralShift: (flex / 90) * 0.14,
        trunkLeanDeg: flex > 60 ? 65 : 0,
      };
    }, 2);
    const result = runLateralLungeSession(frames);
    expect(countWarnings(result, 'trunk-forward')).toBeGreaterThan(0);
  });

  // Valgus is intentionally NOT tracked for the lateral lunge (a front-camera
  // valgus read during the wide lateral step is geometrically unreliable —
  // 2026-05-31 physical-test fix). It must therefore never fire.
  it('does NOT fire any posture warnings on clean reps (sanity)', () => {
    const frames = makeFrames((t) => {
      const flex = repFlex(t);
      return { workingKneeFlexionDeg: flex, lateralShift: (flex / 90) * 0.14 };
    }, 3);
    const result = runLateralLungeSession(frames);
    expect(countWarnings(result, 'valgus')).toBe(0);
    expect(countWarnings(result, 'trunk-forward')).toBe(0);
    expect(countWarnings(result, 'leg-not-straight')).toBe(0);
    expect(countWarnings(result, 'incomplete-lunge')).toBe(0);
  });
});
