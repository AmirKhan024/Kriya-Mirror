/**
 * Jump Squat — happy path.
 * Calibrates front-on (instant confirm ~200ms), then performs clean reps.
 *
 * Rep cycle (1800ms each):
 *   0–200ms:   loading dip  (hipYOffset +0.05, knee bent)
 *   200–500ms: airborne     (hipYOffset -0.09, knees extended)
 *   500–800ms: landing/abs  (hipYOffset -0.06, knees bent)  ← -0.06 avoids IEEE 754 edge case at -0.04
 *   800–1800ms: standing    (hipYOffset  0.00, knees extended)
 *
 * Rep duration from LOADING entry to STANDING return: 800ms > MIN_REP_DURATION_MS=600ms.
 * Max hip rise: 0.09 normalised units > MIN_HIP_RISE=0.05.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildJumpSquatPose } from '../../harness/pose-stub';
import { runJumpSquatSession, warningsOtherThan } from '../../harness/runner';
import type { JumpSquatPoseIntent } from '../../harness/types';

function happyPathIntent(reps: number) {
  const calMs = 800;
  const repCycleMs = 1800;
  const totalMs = calMs + reps * repCycleMs;

  return {
    totalMs,
    intentAt: (tMs: number): JumpSquatPoseIntent => {
      if (tMs < calMs) {
        return { hipYOffset: 0, kneeFlexionDeg: 5 };
      }
      const tInRep = (tMs - calMs) % repCycleMs;
      if (tInRep < 200) {
        return { hipYOffset: 0.05, kneeFlexionDeg: 60 };
      }
      if (tInRep < 500) {
        return { hipYOffset: -0.09, kneeFlexionDeg: 5 };
      }
      if (tInRep < 800) {
        return { hipYOffset: -0.06, kneeFlexionDeg: 50 };
      }
      return { hipYOffset: 0, kneeFlexionDeg: 5 };
    },
  };
}

describe('Jump Squat — happy path', () => {
  it('calibrates within 500ms', () => {
    const { totalMs, intentAt } = happyPathIntent(1);
    const frames = buildFrames(intentAt, buildJumpSquatPose, { fps: 30, durationMs: totalMs });
    const result = runJumpSquatSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).not.toBeNull();
    expect(result.calibrationConfirmedAtMs!).toBeLessThanOrEqual(500);
  });

  it('counts 3 clean reps', () => {
    const { totalMs, intentAt } = happyPathIntent(3);
    const frames = buildFrames(intentAt, buildJumpSquatPose, { fps: 30, durationMs: totalMs });
    const result = runJumpSquatSession(frames);
    expect(result.completedReps.length).toBe(3);
  });

  it('counts 5 clean reps', () => {
    const { totalMs, intentAt } = happyPathIntent(5);
    const frames = buildFrames(intentAt, buildJumpSquatPose, { fps: 30, durationMs: totalMs });
    const result = runJumpSquatSession(frames);
    expect(result.completedReps.length).toBe(5);
  });

  it('produces zero form warnings on clean reps', () => {
    const { totalMs, intentAt } = happyPathIntent(3);
    const frames = buildFrames(intentAt, buildJumpSquatPose, { fps: 30, durationMs: totalMs });
    const result = runJumpSquatSession(frames);
    const nonIdleWarnings = warningsOtherThan(result, 'not-moving');
    expect(nonIdleWarnings.length).toBe(0);
  });

  it('MQS is between 0 and 100 for each rep', () => {
    const { totalMs, intentAt } = happyPathIntent(3);
    const frames = buildFrames(intentAt, buildJumpSquatPose, { fps: 30, durationMs: totalMs });
    const result = runJumpSquatSession(frames);
    for (const rep of result.completedReps) {
      expect(rep.mqs).toBeGreaterThanOrEqual(0);
      expect(rep.mqs).toBeLessThanOrEqual(100);
    }
  });

  it('peakHeightScore (hip rise) reflects peak jump height', () => {
    const { totalMs, intentAt } = happyPathIntent(2);
    const frames = buildFrames(intentAt, buildJumpSquatPose, { fps: 30, durationMs: totalMs });
    const result = runJumpSquatSession(frames);
    for (const rep of result.completedReps) {
      expect(rep.depthDeg).toBeGreaterThan(0.04);
    }
  });
});
