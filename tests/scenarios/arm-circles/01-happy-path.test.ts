import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildArmCirclesPose } from '../../harness/pose-stub';
import { runArmCirclesSession, warningsOtherThan } from '../../harness/runner';

// 2026-05-28 round 21: re-architected to front-camera bilateral abduction.
// 2.2 s calibration (arms at sides), then N reps. Each rep = one full sweep:
//   0–900 ms : raise 0 → 165° (arms overhead)
//   900–1500 : hold at top
//   1500–2700: lower 165 → 0 (1.2 s descent)
//   2700–3000: rest at sides
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
      if (tInRep < 900) abd = (tInRep / 900) * 165;
      else if (tInRep < 1500) abd = 165;
      else if (tInRep < 2700) abd = 165 - ((tInRep - 1500) / 1200) * 165;
      else abd = 0;
      return { abductionDeg: abd };
    },
  };
}

describe('Arm Circles — happy path', () => {
  it('calibrates within 2.2s and counts 5 overhead reps', () => {
    const { totalMs, intentAt } = happyPathIntent(5);
    const frames = buildFrames(intentAt, buildArmCirclesPose, { fps: 30, durationMs: totalMs });

    const result = runArmCirclesSession(frames);

    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThanOrEqual(2300);
    expect(result.completedReps.length).toBeGreaterThanOrEqual(4);
    expect(result.completedReps.length).toBeLessThanOrEqual(5);
    expect(warningsOtherThan(result, 'not-moving').length).toBe(0);
    const avgMqs = result.completedReps.reduce((s, r) => s + r.mqs, 0) / result.completedReps.length;
    expect(avgMqs).toBeGreaterThanOrEqual(50);
  });
});
