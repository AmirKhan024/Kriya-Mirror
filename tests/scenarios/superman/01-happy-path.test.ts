import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildSupermanPose } from '../../harness/pose-stub';
import { runSupermanSession, countWarnings } from '../../harness/runner';
import type { SupermanPoseIntent } from '../../harness/types';

// Calibration phase: ~300ms at 30fps = ~9 frames with shoulderRise=0, armsForward=true
// Rep cycle: 0→0.08→0 over 1200ms
//   0–600ms: rise 0 → 0.08
//   600–1200ms: lower 0.08 → 0
function happyPathIntent(reps: number) {
  const calMs = 500; // generous calibration window (~300ms needed)
  const repCycleMs = 1200;
  const totalMs = calMs + reps * repCycleMs;

  return {
    totalMs,
    intentAt: (tMs: number): SupermanPoseIntent => {
      if (tMs < calMs) {
        return { shoulderRise: 0, armsForward: true };
      }
      const tInRep = (tMs - calMs) % repCycleMs;
      let rise: number;
      if (tInRep < 600) {
        // rising: 0 → 0.08
        rise = (tInRep / 600) * 0.08;
      } else {
        // lowering: 0.08 → 0
        rise = 0.08 - ((tInRep - 600) / 600) * 0.08;
      }
      return { shoulderRise: rise, armsForward: true };
    },
  };
}

describe('Superman — happy path', () => {
  it('calibrates within 500ms and counts 3 clean reps', () => {
    const { totalMs, intentAt } = happyPathIntent(3);
    const frames = buildFrames(intentAt, buildSupermanPose, { fps: 30, durationMs: totalMs });

    const result = runSupermanSession(frames);

    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThanOrEqual(500);
    expect(result.completedReps.length).toBeGreaterThanOrEqual(3);
    result.completedReps.forEach((rep) => {
      expect(rep.mqs).toBeGreaterThanOrEqual(50);
    });
    expect(countWarnings(result, 'incomplete-superman')).toBe(0);
  });

  it('counts 5 reps when given a 5-rep stream', () => {
    const { totalMs, intentAt } = happyPathIntent(5);
    const frames = buildFrames(intentAt, buildSupermanPose, { fps: 30, durationMs: totalMs });
    const result = runSupermanSession(frames);
    expect(result.completedReps.length).toBeGreaterThanOrEqual(5);
  });

  it('calibration state is confirmed after calibration phase', () => {
    const { totalMs, intentAt } = happyPathIntent(3);
    const frames = buildFrames(intentAt, buildSupermanPose, { fps: 30, durationMs: totalMs });
    const result = runSupermanSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
  });

  it('all 3 reps score mqs >= 50', () => {
    const { totalMs, intentAt } = happyPathIntent(3);
    const frames = buildFrames(intentAt, buildSupermanPose, { fps: 30, durationMs: totalMs });
    const result = runSupermanSession(frames);
    expect(result.completedReps.length).toBeGreaterThanOrEqual(3);
    const first3 = result.completedReps.slice(0, 3);
    first3.forEach((rep) => {
      expect(rep.mqs).toBeGreaterThanOrEqual(50);
    });
  });
});
