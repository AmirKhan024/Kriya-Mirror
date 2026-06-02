import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildLungePose } from '../../harness/pose-stub';
import { runReverseLungeSession, warningsOtherThan } from '../../harness/runner';
import type { LungePoseIntent } from '../../harness/types';

// Reverse lunge reuses the lunge pose builder: one (front/planted) leg flexes to
// ~90°, the other extends behind. Cycle mirrors the forward-lunge happy path.
function happyPathIntent(reps: number) {
  const calMs = 2200;
  const repCycleMs = 3000;
  const totalMs = calMs + reps * repCycleMs;
  return {
    totalMs,
    intentAt: (tMs: number): LungePoseIntent => {
      if (tMs < calMs) return { kneeFlexionDeg: 0, frontLeg: 'left', armsAtSides: true };
      const repIndex = Math.floor((tMs - calMs) / repCycleMs);
      const frontLeg: 'left' | 'right' = repIndex % 2 === 0 ? 'left' : 'right';
      const tInRep = (tMs - calMs) % repCycleMs;
      let flex: number;
      if (tInRep < 1000) flex = (tInRep / 1000) * 90;
      else if (tInRep < 1500) flex = 90;
      else if (tInRep < 2500) flex = 90 - ((tInRep - 1500) / 1000) * 90;
      else flex = 0;
      return { kneeFlexionDeg: flex, frontLeg, armsAtSides: false };
    },
  };
}

describe('Reverse Lunge — happy path', () => {
  it('calibrates within 2.3s and counts 6 alternating reps', () => {
    const { totalMs, intentAt } = happyPathIntent(6);
    const frames = buildFrames(intentAt, buildLungePose, { fps: 30, durationMs: totalMs });
    const result = runReverseLungeSession(frames);

    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThanOrEqual(2300);
    expect(result.completedReps.length).toBe(6);
    expect(warningsOtherThan(result, 'not-moving').length).toBe(0);

    const avgMqs = result.completedReps.reduce((s, r) => s + r.mqs, 0) / result.completedReps.length;
    expect(avgMqs).toBeGreaterThanOrEqual(60);

    const actualLegs = result.completedReps.map((r) => r.frontLeg);
    expect(actualLegs).toEqual(['left', 'right', 'left', 'right', 'left', 'right']);
  });
});
