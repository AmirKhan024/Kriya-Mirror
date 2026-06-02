import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildSeatedMarchPose } from '../../harness/pose-stub';
import { runSeatedMarchSession, warningsOtherThan } from '../../harness/runner';
import type { SeatedMarchPoseIntent } from '../../harness/types';

// 1 s seated calibration in BOTH_DOWN, then alternating L/R knee lifts.
// Seated march is gentle: peak 50 % (clear of MIN_REP_HEIGHT_PCT=28) with a
// slow 1600 ms cycle so the EMA-smoothed signal drops below LOW=10 on the
// descending side before the rising side takes over. One cycle = 2 reps.
function happyPathIntent(reps: number) {
  const calMs = 1000;
  const cyclesNeeded = Math.ceil(reps / 2);
  const cycleMs = 1600;
  const totalMs = calMs + cyclesNeeded * cycleMs + 800;
  return {
    totalMs,
    intentAt: (tMs: number): SeatedMarchPoseIntent => {
      if (tMs < calMs) return { leftKneeLiftPct: 0, rightKneeLiftPct: 0 };
      const t = (tMs - calMs) % cycleMs;
      let left: number, right: number;
      if (t < 400) { left = (t / 400) * 50; right = 0; }
      else if (t < 800) { left = 50; right = 0; }
      else if (t < 1200) { const u = (t - 800) / 400; left = 50 * (1 - u); right = 50 * u; }
      else if (t < 1500) { left = 0; right = 50; }
      else { left = 0; right = 50 * (1 - (t - 1500) / 100); }
      return { leftKneeLiftPct: left, rightKneeLiftPct: right };
    },
  };
}

describe('Seated March — happy path', () => {
  it('calibrates quickly (seated) and counts 10 alternating reps', () => {
    const { totalMs, intentAt } = happyPathIntent(10);
    const frames = buildFrames(intentAt, buildSeatedMarchPose, { fps: 30, durationMs: totalMs });

    const result = runSeatedMarchSession(frames);

    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThanOrEqual(600);
    expect(result.completedReps.length).toBeGreaterThanOrEqual(10);
    expect(warningsOtherThan(result, 'not-moving').length).toBe(0);
    const avgMqs = result.completedReps.reduce((s, r) => s + r.mqs, 0) / result.completedReps.length;
    expect(avgMqs).toBeGreaterThanOrEqual(60);
  });

  it('reps alternate sides (left/right/left/right…)', () => {
    const { totalMs, intentAt } = happyPathIntent(10);
    const frames = buildFrames(intentAt, buildSeatedMarchPose, { fps: 30, durationMs: totalMs });
    const result = runSeatedMarchSession(frames);

    expect(result.completedReps.length).toBeGreaterThanOrEqual(6);
    for (let i = 1; i < result.completedReps.length; i++) {
      expect(result.completedReps[i].side).not.toBe(result.completedReps[i - 1].side);
    }
  });
});
