import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildChairDipPose } from '../../harness/pose-stub';
import { runChairDipSession, warningsOtherThan } from '../../harness/runner';

/** Linearly ramps shoulderDescentY from 0 at flex≤5° to 0.04 at flex≥90°. */
function dipShoulderDescent(flex: number): number {
  return Math.max(0, Math.min(0.04, (flex - 5) / 85 * 0.04));
}

// Calibration: 500ms at elbowFlexionDeg=5 (arms nearly straight at sides).
// Each rep cycle (2500ms total):
//   EXTENDED   (0–300ms)   : flex=5  (arms straight, resting)
//   DIPPING    (300–800ms) : flex 5 → 90 (descending)
//   AT_BOTTOM  (800–1000ms): flex=90 (held at bottom)
//   PRESSING   (1000–1500ms): flex 90 → 5 (pressing back up)
//   REST       (1500–2500ms): flex=5  (recovery between reps)
function happyPathIntent(reps: number) {
  const calMs = 500;
  const repCycleMs = 2500;
  const totalMs = calMs + reps * repCycleMs;

  return {
    totalMs,
    intentAt: (tMs: number) => {
      if (tMs < calMs) {
        return { elbowFlexionDeg: 5, feetWidthRatio: 1.0, bodyHeight: 0.70, shoulderDescentY: 0 };
      }
      const tInRep = (tMs - calMs) % repCycleMs;
      let flex: number;
      if (tInRep < 300) {
        flex = 5;
      } else if (tInRep < 800) {
        flex = 5 + ((tInRep - 300) / 500) * 85; // 5 → 90
      } else if (tInRep < 1000) {
        flex = 90;
      } else if (tInRep < 1500) {
        flex = 90 - ((tInRep - 1000) / 500) * 85; // 90 → 5
      } else {
        flex = 5;
      }
      return { elbowFlexionDeg: flex, feetWidthRatio: 1.0, bodyHeight: 0.70, shoulderDescentY: dipShoulderDescent(flex) };
    },
  };
}

describe('Chair Dip — happy path', () => {
  it('calibrates quickly (within 500ms) and counts 5 clean reps', () => {
    const { totalMs, intentAt } = happyPathIntent(5);
    const frames = buildFrames(intentAt, buildChairDipPose, { fps: 30, durationMs: totalMs });

    const result = runChairDipSession(frames);

    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThanOrEqual(500);
    expect(result.completedReps.length).toBe(5);
  });

  it('assigns mqs > 0 on every rep', () => {
    const { totalMs, intentAt } = happyPathIntent(5);
    const frames = buildFrames(intentAt, buildChairDipPose, { fps: 30, durationMs: totalMs });

    const result = runChairDipSession(frames);

    expect(result.completedReps.length).toBe(5);
    for (const rep of result.completedReps) {
      expect(rep.mqs).toBeGreaterThan(0);
    }
  });

  it('fires no unexpected warnings during clean reps', () => {
    const { totalMs, intentAt } = happyPathIntent(5);
    const frames = buildFrames(intentAt, buildChairDipPose, { fps: 30, durationMs: totalMs });

    const result = runChairDipSession(frames);

    expect(warningsOtherThan(result, 'not-moving').length).toBe(0);
  });

  it('counts 3 reps when given a 3-rep stream', () => {
    const { totalMs, intentAt } = happyPathIntent(3);
    const frames = buildFrames(intentAt, buildChairDipPose, { fps: 30, durationMs: totalMs });

    const result = runChairDipSession(frames);

    expect(result.completedReps.length).toBe(3);
  });
});
