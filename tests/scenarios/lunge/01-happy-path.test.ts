import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildLungePose } from '../../harness/pose-stub';
import { runLungeSession, warningsOtherThan } from '../../harness/runner';

// 2.2 s calibration (standing, feet hip-width, arms at sides), then N reps
// alternating legs. Each rep:
//   0–1000 ms : descend 0° → 90° front-knee flex
//   1000–1500 : hold at bottom
//   1500–2500 : ascend 90° → 0°
//   2500–3000 : rest standing
function happyPathIntent(reps: number) {
  const calMs = 2200;
  const repCycleMs = 3000;
  const totalMs = calMs + reps * repCycleMs;
  return {
    totalMs,
    intentAt: (tMs: number) => {
      if (tMs < calMs) {
        return { kneeFlexionDeg: 0, frontLeg: 'left' as const, armsAtSides: true };
      }
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

describe('Lunge — happy path', () => {
  it('calibrates within 2.2s and counts 6 alternating reps', () => {
    const { totalMs, intentAt } = happyPathIntent(6);
    const frames = buildFrames(intentAt, buildLungePose, { fps: 30, durationMs: totalMs });

    const result = runLungeSession(frames);

    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThanOrEqual(2300);
    expect(result.completedReps.length).toBe(6);
    expect(warningsOtherThan(result, 'not-moving').length).toBe(0);

    const avgMqs = result.completedReps.reduce((s, r) => s + r.mqs, 0) / result.completedReps.length;
    expect(avgMqs).toBeGreaterThanOrEqual(60);

    // Alternating leg pattern (left, right, left, right, ...)
    const expectedLegs: ('left' | 'right')[] = ['left', 'right', 'left', 'right', 'left', 'right'];
    const actualLegs = result.completedReps.map((r) => r.frontLeg);
    expect(actualLegs).toEqual(expectedLegs);
  });

  it('counts 4 reps when given a 4-rep stream', () => {
    const { totalMs, intentAt } = happyPathIntent(4);
    const frames = buildFrames(intentAt, buildLungePose, { fps: 30, durationMs: totalMs });
    const result = runLungeSession(frames);
    expect(result.completedReps.length).toBe(4);
  });
});
