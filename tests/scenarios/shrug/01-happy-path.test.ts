import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildShrugPose } from '../../harness/pose-stub';
import { runShrugSession, warningsOtherThan } from '../../harness/runner';

function happyPathIntent(reps: number) {
  const calMs = 2200;
  const repCycleMs = 3000;
  const totalMs = calMs + reps * repCycleMs;
  return {
    totalMs,
    intentAt: (tMs: number) => {
      if (tMs < calMs) return { shoulderElevation: 0 };
      const tInRep = (tMs - calMs) % repCycleMs;
      let elev: number;
      // Rise for 1s, hold at top for 0.5s, lower for 1s, rest 0.5s
      if (tInRep < 1000) elev = (tInRep / 1000) * 0.05;
      else if (tInRep < 1500) elev = 0.05;
      else if (tInRep < 2500) elev = 0.05 - ((tInRep - 1500) / 1000) * 0.05;
      else elev = 0;
      return { shoulderElevation: elev };
    },
  };
}

describe('Shrug — happy path', () => {
  it('calibrates within 2.2s and counts 3 perfect reps', () => {
    const { totalMs, intentAt } = happyPathIntent(3);
    const frames = buildFrames(intentAt, buildShrugPose, { fps: 30, durationMs: totalMs });

    const result = runShrugSession(frames);

    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThanOrEqual(2300);
    expect(result.completedReps.length).toBe(3);
    expect(warningsOtherThan(result, 'not-moving').length).toBe(0);
    const avgMqs = result.completedReps.reduce((s, r) => s + r.mqs, 0) / result.completedReps.length;
    expect(avgMqs).toBeGreaterThanOrEqual(50);
  });

  it('counts 5 reps when given a 5-rep stream', () => {
    const { totalMs, intentAt } = happyPathIntent(5);
    const frames = buildFrames(intentAt, buildShrugPose, { fps: 30, durationMs: totalMs });
    const result = runShrugSession(frames);
    expect(result.completedReps.length).toBe(5);
  });
});
