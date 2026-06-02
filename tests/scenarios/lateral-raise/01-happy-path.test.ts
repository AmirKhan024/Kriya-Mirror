import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildLateralRaisePose } from '../../harness/pose-stub';
import { runLateralRaiseSession, warningsOtherThan } from '../../harness/runner';

// 2.2 s calibration in DOWN position (arms at sides), then N reps. Each rep:
//   0–1000 ms : raise 0° → 88° abduction
//   1000–1500 : hold at top
//   1500–2500 : lower 88° → 0°
//   2500–3000 : rest at sides
function happyPathIntent(reps: number) {
  const calMs = 2200;
  const repCycleMs = 3000;
  const totalMs = calMs + reps * repCycleMs;
  return {
    totalMs,
    intentAt: (tMs: number) => {
      if (tMs < calMs) return { abductionDeg: 0 };
      const tInRep = (tMs - calMs) % repCycleMs;
      let abd: number;
      if (tInRep < 1000) abd = (tInRep / 1000) * 88;
      else if (tInRep < 1500) abd = 88;
      else if (tInRep < 2500) abd = 88 - ((tInRep - 1500) / 1000) * 88;
      else abd = 0;
      return { abductionDeg: abd };
    },
  };
}

describe('Lateral Raise — happy path', () => {
  it('calibrates within 2.3s and counts 10 perfect reps', () => {
    const { totalMs, intentAt } = happyPathIntent(10);
    const frames = buildFrames(intentAt, buildLateralRaisePose, { fps: 30, durationMs: totalMs });

    const result = runLateralRaiseSession(frames);

    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThanOrEqual(2300);
    expect(result.completedReps.length).toBe(10);
    expect(warningsOtherThan(result, 'not-moving').length).toBe(0);
    const avgMqs = result.completedReps.reduce((s, r) => s + r.mqs, 0) / result.completedReps.length;
    expect(avgMqs).toBeGreaterThanOrEqual(60);
  });

  it('counts 5 reps when given a 5-rep stream', () => {
    const { totalMs, intentAt } = happyPathIntent(5);
    const frames = buildFrames(intentAt, buildLateralRaisePose, { fps: 30, durationMs: totalMs });
    const result = runLateralRaiseSession(frames);
    expect(result.completedReps.length).toBe(5);
  });
});
