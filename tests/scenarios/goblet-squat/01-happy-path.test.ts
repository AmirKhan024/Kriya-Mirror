import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildGobletSquatPose } from '../../harness/pose-stub';
import { runGobletSquatSession, warningsOtherThan } from '../../harness/runner';
import type { GobletSquatPoseIntent } from '../../harness/types';

// Calibration: 2.2s in goblet position (elbows spread, feet wide)
// Then N reps:
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
    intentAt: (tMs: number): GobletSquatPoseIntent => {
      if (tMs < calMs) {
        // Calibration: elbows spread (ratio 1.0), feet wide, standing
        return {
          kneeFlexionDeg: 0,
          feetWidthRatio: 1.25,
          elbowSpreadRatio: 1.0,
          bodyHeight: 0.70,
        };
      }
      const tInRep = (tMs - calMs) % repCycleMs;
      let kneeFlexionDeg: number;
      if (tInRep < 1000) kneeFlexionDeg = (tInRep / 1000) * 100;
      else if (tInRep < 1500) kneeFlexionDeg = 100;
      else if (tInRep < 2500) kneeFlexionDeg = 100 - ((tInRep - 1500) / 1000) * 100;
      else kneeFlexionDeg = 0;
      return {
        kneeFlexionDeg,
        feetWidthRatio: 1.25,
        elbowSpreadRatio: 1.0,
        bodyHeight: 0.70,
      };
    },
  };
}

describe('Goblet Squat — happy path', () => {
  it('calibrates within 2.2s and counts 10 perfect reps', () => {
    const { totalMs, intentAt } = happyPathIntent(10);
    const frames = buildFrames(intentAt, buildGobletSquatPose, { fps: 30, durationMs: totalMs });

    const result = runGobletSquatSession(frames);

    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThanOrEqual(2300);
    expect(result.completedReps.length).toBe(10);
    expect(warningsOtherThan(result, 'not-moving').length).toBe(0);
    const avgMqs = result.completedReps.reduce((s, r) => s + r.mqs, 0) / result.completedReps.length;
    expect(avgMqs).toBeGreaterThanOrEqual(60);
  });

  it('counts 5 reps when given a 5-rep stream', () => {
    const { totalMs, intentAt } = happyPathIntent(5);
    const frames = buildFrames(intentAt, buildGobletSquatPose, { fps: 30, durationMs: totalMs });
    const result = runGobletSquatSession(frames);
    expect(result.completedReps.length).toBe(5);
  });

  it('emits no goblet-elbows-collapsing warning when elbows are spread throughout', () => {
    const { totalMs, intentAt } = happyPathIntent(3);
    const frames = buildFrames(intentAt, buildGobletSquatPose, { fps: 30, durationMs: totalMs });
    const result = runGobletSquatSession(frames);
    const collapseWarnings = result.warnings.filter((w) => (w.type as string) === 'goblet-elbows-collapsing');
    expect(collapseWarnings.length).toBe(0);
  });
});
