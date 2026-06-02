/**
 * Romanian Deadlift — happy path.
 * Calibrates side-on (instant confirm ~200ms), then performs clean RDLs.
 *
 * Rep cycle (3000ms each):
 *   0–1000 ms: hinge 0° → 65°
 *   1000–1500: hold at bottom (65°)
 *   1500–2500: extend 65° → 0°
 *   2500–3000: stand still
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildRomanianDeadliftPose } from '../../harness/pose-stub';
import { runRDLSession, warningsOtherThan } from '../../harness/runner';
import type { RomanianDeadliftPoseIntent } from '../../harness/types';

function happyPathIntent(reps: number) {
  const calMs = 1000;
  const repCycleMs = 3000;
  const totalMs = calMs + reps * repCycleMs;

  return {
    totalMs,
    intentAt: (tMs: number): RomanianDeadliftPoseIntent => {
      if (tMs < calMs) {
        return { hipHingeDeg: 0, kneeAngleDeg: 15 };
      }
      const tInRep = (tMs - calMs) % repCycleMs;
      let hinge: number;
      if (tInRep < 1000) hinge = (tInRep / 1000) * 65;
      else if (tInRep < 1500) hinge = 65;
      else if (tInRep < 2500) hinge = 65 - ((tInRep - 1500) / 1000) * 65;
      else hinge = 0;
      return { hipHingeDeg: hinge, kneeAngleDeg: 15 };
    },
  };
}

describe('Romanian Deadlift — happy path', () => {
  it('calibrates within 500ms and counts 4 reps', () => {
    const { totalMs, intentAt } = happyPathIntent(4);
    const frames = buildFrames(intentAt, buildRomanianDeadliftPose, { fps: 30, durationMs: totalMs });
    const result = runRDLSession(frames);

    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThanOrEqual(500);
    expect(result.completedReps.length).toBe(4);
    expect(warningsOtherThan(result, 'not-moving').length).toBe(0);
  });

  it('counts 5 reps when given a 5-rep stream', () => {
    const { totalMs, intentAt } = happyPathIntent(5);
    const frames = buildFrames(intentAt, buildRomanianDeadliftPose, { fps: 30, durationMs: totalMs });
    const result = runRDLSession(frames);
    expect(result.completedReps.length).toBe(5);
  });

  it('counts 3 reps when given a 3-rep stream', () => {
    const { totalMs, intentAt } = happyPathIntent(3);
    const frames = buildFrames(intentAt, buildRomanianDeadliftPose, { fps: 30, durationMs: totalMs });
    const result = runRDLSession(frames);
    expect(result.completedReps.length).toBe(3);
  });

  it('rep depthDeg reflects peak hinge angle', () => {
    const { totalMs, intentAt } = happyPathIntent(2);
    const frames = buildFrames(intentAt, buildRomanianDeadliftPose, { fps: 30, durationMs: totalMs });
    const result = runRDLSession(frames);
    for (const rep of result.completedReps) {
      // EMA-attenuated from 65° target — expect ≥ 45° given EMA smoothing
      expect(rep.depthDeg).toBeGreaterThanOrEqual(45);
      expect(rep.depthDeg).toBeLessThanOrEqual(70);
    }
  });

  it('MQS is between 0 and 100', () => {
    const { totalMs, intentAt } = happyPathIntent(2);
    const frames = buildFrames(intentAt, buildRomanianDeadliftPose, { fps: 30, durationMs: totalMs });
    const result = runRDLSession(frames);
    for (const rep of result.completedReps) {
      expect(rep.mqs).toBeGreaterThanOrEqual(0);
      expect(rep.mqs).toBeLessThanOrEqual(100);
    }
  });

  it('frame metrics are emitted for every tracking frame', () => {
    const { totalMs, intentAt } = happyPathIntent(1);
    const frames = buildFrames(intentAt, buildRomanianDeadliftPose, { fps: 30, durationMs: totalMs });
    const result = runRDLSession(frames);
    // After calibration (~200ms), tracking frames are emitted
    expect(result.frameMetricsSamples.length).toBeGreaterThan(50);
  });
});
