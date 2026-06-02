import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildHammerCurlPose } from '../../harness/pose-stub';
import { runHammerCurlSession, warningsOtherThan } from '../../harness/runner';

function happyPathIntent(reps: number) {
  const calMs = 2200;
  const repCycleMs = 3000;
  const totalMs = calMs + reps * repCycleMs;
  return {
    totalMs,
    intentAt: (tMs: number) => {
      if (tMs < calMs) return { elbowFlexionDeg: 0 };
      const tInRep = (tMs - calMs) % repCycleMs;
      let flex: number;
      if (tInRep < 1000) flex = (tInRep / 1000) * 130;
      else if (tInRep < 1500) flex = 130;
      else if (tInRep < 2500) flex = 130 - ((tInRep - 1500) / 1000) * 130;
      else flex = 0;
      return { elbowFlexionDeg: flex };
    },
  };
}

describe('Hammer Curl — happy path', () => {
  it('calibrates within 2.2s and counts 10 perfect reps', () => {
    const { totalMs, intentAt } = happyPathIntent(10);
    const frames = buildFrames(intentAt, buildHammerCurlPose, { fps: 30, durationMs: totalMs });

    const result = runHammerCurlSession(frames);

    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThanOrEqual(2300);
    expect(result.completedReps.length).toBe(10);
    expect(warningsOtherThan(result, 'not-moving').length).toBe(0);
    const avgMqs = result.completedReps.reduce((s, r) => s + r.mqs, 0) / result.completedReps.length;
    expect(avgMqs).toBeGreaterThanOrEqual(60);
  });

  it('counts 5 reps when given a 5-rep stream', () => {
    const { totalMs, intentAt } = happyPathIntent(5);
    const frames = buildFrames(intentAt, buildHammerCurlPose, { fps: 30, durationMs: totalMs });
    const result = runHammerCurlSession(frames);
    expect(result.completedReps.length).toBe(5);
  });
});
