import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildPullUpPose } from '../../harness/pose-stub';
import { runPullUpSession, warningsOtherThan } from '../../harness/runner';

// 2.2 s calibration in dead-hang (flex=0), then N reps. Each rep:
//   0–1000 ms : pull 0° → 130° elbow flex
//   1000–1500 : hold at top
//   1500–2500 : lower 130° → 0°
//   2500–3000 : rest at dead hang
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

describe('Pull-Up — happy path', () => {
  it('calibrates within 2.2s and counts 10 perfect reps', () => {
    const { totalMs, intentAt } = happyPathIntent(10);
    const frames = buildFrames(intentAt, buildPullUpPose, { fps: 30, durationMs: totalMs });

    const result = runPullUpSession(frames);

    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThanOrEqual(2300);
    expect(result.completedReps.length).toBe(10);
    expect(warningsOtherThan(result, 'not-moving').length).toBe(0);
    const avgMqs = result.completedReps.reduce((s, r) => s + r.mqs, 0) / result.completedReps.length;
    expect(avgMqs).toBeGreaterThanOrEqual(60);
  });

  it('counts 5 reps when given a 5-rep stream', () => {
    const { totalMs, intentAt } = happyPathIntent(5);
    const frames = buildFrames(intentAt, buildPullUpPose, { fps: 30, durationMs: totalMs });
    const result = runPullUpSession(frames);
    expect(result.completedReps.length).toBe(5);
  });

  it('each rep carries depthDeg >= 90', () => {
    const { totalMs, intentAt } = happyPathIntent(3);
    const frames = buildFrames(intentAt, buildPullUpPose, { fps: 30, durationMs: totalMs });
    const result = runPullUpSession(frames);
    for (const rep of result.completedReps) {
      expect(rep.depthDeg).toBeGreaterThanOrEqual(90);
    }
  });
});
