import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildPistolSquatPose } from '../../harness/pose-stub';
import { runPistolSquatSession, warningsOtherThan } from '../../harness/runner';
import type { PistolSquatPoseIntent } from '../../harness/types';

// 2.2 s calibration (standing, both feet on ground, body upright), then N reps
// alternating standing legs. Each rep:
//   0–1200 ms : descend 0° → 90° standing-knee flex
//   1200–1700 : hold at bottom
//   1700–2900 : ascend 90° → 0°
//   2900–3500 : rest standing
function happyPathIntent(reps: number) {
  const calMs = 2200;
  const repCycleMs = 3500;
  const totalMs = calMs + reps * repCycleMs;
  return {
    totalMs,
    intentAt: (tMs: number): PistolSquatPoseIntent => {
      if (tMs < calMs) {
        return { kneeFlexionDeg: 0, standingLeg: 'left', armsForward: false };
      }
      const repIndex = Math.floor((tMs - calMs) / repCycleMs);
      const standingLeg: 'left' | 'right' = repIndex % 2 === 0 ? 'left' : 'right';
      const tInRep = (tMs - calMs) % repCycleMs;
      let flex: number;
      if (tInRep < 1200) flex = (tInRep / 1200) * 90;
      else if (tInRep < 1700) flex = 90;
      else if (tInRep < 2900) flex = 90 - ((tInRep - 1700) / 1200) * 90;
      else flex = 0;
      return { kneeFlexionDeg: flex, standingLeg, armsForward: true };
    },
  };
}

describe('Pistol Squat — happy path', () => {
  it('calibrates within 2.3s and counts 4 reps alternating standing legs', () => {
    const { totalMs, intentAt } = happyPathIntent(4);
    const frames = buildFrames(intentAt, buildPistolSquatPose, { fps: 30, durationMs: totalMs });

    const result = runPistolSquatSession(frames);

    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThanOrEqual(2300);
    expect(result.completedReps.length).toBe(4);
    expect(warningsOtherThan(result, 'not-moving').length).toBe(0);

    const avgMqs = result.completedReps.reduce((s, r) => s + r.mqs, 0) / result.completedReps.length;
    expect(avgMqs).toBeGreaterThanOrEqual(60);

    // Alternating leg pattern (left, right, left, right)
    const expectedLegs: ('left' | 'right')[] = ['left', 'right', 'left', 'right'];
    const actualLegs = result.completedReps.map((r) => r.standingLeg);
    expect(actualLegs).toEqual(expectedLegs);
  });

  it('counts 2 reps when given a 2-rep stream', () => {
    const { totalMs, intentAt } = happyPathIntent(2);
    const frames = buildFrames(intentAt, buildPistolSquatPose, { fps: 30, durationMs: totalMs });
    const result = runPistolSquatSession(frames);
    expect(result.completedReps.length).toBe(2);
  });
});
