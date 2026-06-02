/**
 * Kettlebell Swing — happy path.
 * Calibrates side-on (instant confirm ≈ 200ms), then performs clean reps.
 *
 * Rep cycle (3000ms each):
 *   0–800ms:   stand at 0° (between reps)
 *   800–1600:  hike back 0° → 65°
 *   1600–1900: hold at bottom (65°)
 *   1900–2700: snap forward 65° → 0°
 *   2700–3000: stand still
 *
 * States expected: STANDING→HIKE_BACK→AT_BOTTOM→SNAPPING→STANDING per rep.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildKBSwingPose } from '../../harness/pose-stub';
import { runKBSwingSession, warningsOtherThan } from '../../harness/runner';
import type { KBSwingPoseIntent } from '../../harness/types';

function happyPathIntent(reps: number) {
  const calMs = 1000;
  const repCycleMs = 3000;
  const totalMs = calMs + reps * repCycleMs;

  return {
    totalMs,
    intentAt: (tMs: number): KBSwingPoseIntent => {
      if (tMs < calMs) {
        return { hipHingeDeg: 0 };
      }
      const tInRep = (tMs - calMs) % repCycleMs;
      let hinge: number;
      if (tInRep < 800) hinge = 0;
      else if (tInRep < 1600) hinge = ((tInRep - 800) / 800) * 65;
      else if (tInRep < 1900) hinge = 65;
      else if (tInRep < 2700) hinge = 65 - ((tInRep - 1900) / 800) * 65;
      else hinge = 0;
      return { hipHingeDeg: hinge };
    },
  };
}

describe('Kettlebell Swing — happy path', () => {
  it('calibrates within 500ms and counts 5 reps', () => {
    const { totalMs, intentAt } = happyPathIntent(5);
    const frames = buildFrames(intentAt, buildKBSwingPose, { fps: 30, durationMs: totalMs });
    const result = runKBSwingSession(frames);

    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThanOrEqual(500);
    expect(result.completedReps.length).toBe(5);
    expect(warningsOtherThan(result, 'not-moving').length).toBe(0);
  });

  it('counts 3 reps when given a 3-rep stream', () => {
    const { totalMs, intentAt } = happyPathIntent(3);
    const frames = buildFrames(intentAt, buildKBSwingPose, { fps: 30, durationMs: totalMs });
    const result = runKBSwingSession(frames);
    expect(result.completedReps.length).toBe(3);
  });

  it('rep depthDeg is approximately the peak hinge angle', () => {
    const { totalMs, intentAt } = happyPathIntent(2);
    const frames = buildFrames(intentAt, buildKBSwingPose, { fps: 30, durationMs: totalMs });
    const result = runKBSwingSession(frames);
    for (const rep of result.completedReps) {
      // Smoothed EMA peak at 65° target — expect ≥ 45° given EMA attenuation
      expect(rep.depthDeg).toBeGreaterThanOrEqual(45);
      expect(rep.depthDeg).toBeLessThanOrEqual(70);
    }
  });

  it('MQS is between 0 and 100', () => {
    const { totalMs, intentAt } = happyPathIntent(2);
    const frames = buildFrames(intentAt, buildKBSwingPose, { fps: 30, durationMs: totalMs });
    const result = runKBSwingSession(frames);
    for (const rep of result.completedReps) {
      expect(rep.mqs).toBeGreaterThanOrEqual(0);
      expect(rep.mqs).toBeLessThanOrEqual(100);
    }
  });
});
