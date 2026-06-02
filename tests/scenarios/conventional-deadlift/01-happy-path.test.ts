/**
 * Conventional Deadlift — happy path.
 * Calibrates side-on (instant confirm ≈ 200ms), then performs clean reps.
 *
 * Rep cycle (3000ms each):
 *   0–1000 ms: hinge 0° → 80°
 *   1000–1500: hold at bottom (80°)
 *   1500–2500: extend 80° → 0°
 *   2500–3000: stand still
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildDeadliftPose } from '../../harness/pose-stub';
import { runDeadliftSession, warningsOtherThan } from '../../harness/runner';
import type { DeadliftPoseIntent } from '../../harness/types';

function happyPathIntent(reps: number) {
  const calMs = 1000;
  const repCycleMs = 3000;
  const totalMs = calMs + reps * repCycleMs;

  return {
    totalMs,
    intentAt: (tMs: number): DeadliftPoseIntent => {
      if (tMs < calMs) {
        return { hipHingeDeg: 0, armsAtSides: true };
      }
      const tInRep = (tMs - calMs) % repCycleMs;
      let hinge: number;
      if (tInRep < 1000) hinge = (tInRep / 1000) * 80;
      else if (tInRep < 1500) hinge = 80;
      else if (tInRep < 2500) hinge = 80 - ((tInRep - 1500) / 1000) * 80;
      else hinge = 0;
      return { hipHingeDeg: hinge, armsAtSides: true };
    },
  };
}

describe('Conventional Deadlift — happy path', () => {
  it('calibrates within 500ms and counts 4 reps', () => {
    const { totalMs, intentAt } = happyPathIntent(4);
    const frames = buildFrames(intentAt, buildDeadliftPose, { fps: 30, durationMs: totalMs });
    const result = runDeadliftSession(frames);

    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThanOrEqual(500);
    expect(result.completedReps.length).toBe(4);
    expect(warningsOtherThan(result, 'not-moving').length).toBe(0);

    const avgMqs = result.completedReps.reduce((s, r) => s + r.mqs, 0) / result.completedReps.length;
    expect(avgMqs).toBeGreaterThanOrEqual(60);
  });

  it('counts 3 reps when given a 3-rep stream', () => {
    const { totalMs, intentAt } = happyPathIntent(3);
    const frames = buildFrames(intentAt, buildDeadliftPose, { fps: 30, durationMs: totalMs });
    const result = runDeadliftSession(frames);
    expect(result.completedReps.length).toBe(3);
  });

  it('rep depthDeg is approximately the peak hinge angle', () => {
    const { totalMs, intentAt } = happyPathIntent(2);
    const frames = buildFrames(intentAt, buildDeadliftPose, { fps: 30, durationMs: totalMs });
    const result = runDeadliftSession(frames);
    for (const rep of result.completedReps) {
      // Smoothed EMA peak at 80° target — expect ≥ 55° given EMA attenuation
      expect(rep.depthDeg).toBeGreaterThanOrEqual(55);
      expect(rep.depthDeg).toBeLessThanOrEqual(85);
    }
  });

  it('MQS is between 0 and 100', () => {
    const { totalMs, intentAt } = happyPathIntent(2);
    const frames = buildFrames(intentAt, buildDeadliftPose, { fps: 30, durationMs: totalMs });
    const result = runDeadliftSession(frames);
    for (const rep of result.completedReps) {
      expect(rep.mqs).toBeGreaterThanOrEqual(0);
      expect(rep.mqs).toBeLessThanOrEqual(100);
    }
  });
});
