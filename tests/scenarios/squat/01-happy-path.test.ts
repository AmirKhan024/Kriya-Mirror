import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildSquatPose } from '../../harness/pose-stub';
import { runSquatSession, warningsOtherThan } from '../../harness/runner';

// 2 s calibration in proper posture, then N reps. Each rep:
//   0–1000 ms : descend 0° → 100°
//   1000–1500 : hold at bottom
//   1500–2500 : ascend 100° → 0°
//   2500–3000 : rest upright
function happyPathIntent(reps: number) {
  const calMs = 2200;
  const repCycleMs = 3000;
  const totalMs = calMs + reps * repCycleMs;
  return {
    totalMs,
    intentAt: (tMs: number) => {
      if (tMs < calMs) {
        return { kneeFlexionDeg: 0, feetWidthRatio: 1.25, armsOverhead: true, bodyHeight: 0.70 };
      }
      const tInRep = (tMs - calMs) % repCycleMs;
      let kneeFlexionDeg: number;
      if (tInRep < 1000) kneeFlexionDeg = (tInRep / 1000) * 100;
      else if (tInRep < 1500) kneeFlexionDeg = 100;
      else if (tInRep < 2500) kneeFlexionDeg = 100 - ((tInRep - 1500) / 1000) * 100;
      else kneeFlexionDeg = 0;
      return { kneeFlexionDeg, feetWidthRatio: 1.25, armsOverhead: false, bodyHeight: 0.70 };
    },
  };
}

describe('Squat — happy path', () => {
  it('calibrates within 2.2s and counts 10 perfect reps', () => {
    const { totalMs, intentAt } = happyPathIntent(10);
    const frames = buildFrames(intentAt, buildSquatPose, { fps: 30, durationMs: totalMs });

    const result = runSquatSession(frames);

    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThanOrEqual(2300);
    expect(result.completedReps.length).toBe(10);
    expect(warningsOtherThan(result, 'not-moving').length).toBe(0);
    const avgMqs = result.completedReps.reduce((s, r) => s + r.mqs, 0) / result.completedReps.length;
    expect(avgMqs).toBeGreaterThanOrEqual(60);
  });

  it('counts 5 reps when given a 5-rep stream', () => {
    const { totalMs, intentAt } = happyPathIntent(5);
    const frames = buildFrames(intentAt, buildSquatPose, { fps: 30, durationMs: totalMs });
    const result = runSquatSession(frames);
    expect(result.completedReps.length).toBe(5);
  });
});
