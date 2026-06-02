import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildCossackSquatPose } from '../../harness/pose-stub';
import { runCossackSquatSession, warningsOtherThan } from '../../harness/runner';
import type { CossackSquatPoseIntent } from '../../harness/types';

// 2.2 s calibration (standing in a WIDE stance, arms at sides), then N reps
// alternating sides. Each rep deepens the working-knee flex AND shifts the
// pelvis over the working leg together (feet stay planted wide):
//   0–1000 ms : sink 0° → 95°
//   1000–1500 : hold at the bottom
//   1500–2500 : rise 95° → 0°
//   2500–3000 : rest standing wide
function happyPathIntent(reps: number) {
  const calMs = 2200;
  const repCycleMs = 3000;
  const totalMs = calMs + reps * repCycleMs;
  return {
    totalMs,
    intentAt: (tMs: number): CossackSquatPoseIntent => {
      if (tMs < calMs) {
        return { workingKneeFlexionDeg: 0, workingSide: 'left', hipShift: 0, feetWidthRatio: 1.8, armsAtSides: true };
      }
      const repIndex = Math.floor((tMs - calMs) / repCycleMs);
      const workingSide: 'left' | 'right' = repIndex % 2 === 0 ? 'left' : 'right';
      const tInRep = (tMs - calMs) % repCycleMs;
      let flex: number;
      if (tInRep < 1000) flex = (tInRep / 1000) * 95;
      else if (tInRep < 1500) flex = 95;
      else if (tInRep < 2500) flex = 95 - ((tInRep - 1500) / 1000) * 95;
      else flex = 0;
      const hipShift = (flex / 95) * 0.05;
      return { workingKneeFlexionDeg: flex, workingSide, hipShift, feetWidthRatio: 1.8, armsAtSides: true };
    },
  };
}

describe('Cossack Squat — happy path', () => {
  it('calibrates within 2.2s (wide stance) and counts 6 alternating deep reps', () => {
    const { totalMs, intentAt } = happyPathIntent(6);
    const frames = buildFrames(intentAt, buildCossackSquatPose, { fps: 30, durationMs: totalMs });

    const result = runCossackSquatSession(frames);

    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThanOrEqual(2300);
    expect(result.completedReps.length).toBe(6);
    expect(warningsOtherThan(result, 'not-moving').length).toBe(0);

    const avgMqs = result.completedReps.reduce((s, r) => s + r.mqs, 0) / result.completedReps.length;
    expect(avgMqs).toBeGreaterThanOrEqual(55);

    const expectedSides: ('left' | 'right')[] = ['left', 'right', 'left', 'right', 'left', 'right'];
    expect(result.completedReps.map((r) => r.frontLeg)).toEqual(expectedSides);
  });

  it('counts 4 reps when given a 4-rep stream', () => {
    const { totalMs, intentAt } = happyPathIntent(4);
    const frames = buildFrames(intentAt, buildCossackSquatPose, { fps: 30, durationMs: totalMs });
    const result = runCossackSquatSession(frames);
    expect(result.completedReps.length).toBe(4);
  });
});
