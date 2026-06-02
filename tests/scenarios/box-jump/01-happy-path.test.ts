/**
 * Box Jump — happy path.
 * Calibrates side-on (instant confirm ~200ms), then performs clean reps.
 *
 * Rep cycle (1800ms each):
 *   0–200 ms:   loading dip  (hipYOffset +0.06, knee 130°)
 *   200–500 ms: airborne     (hipYOffset -0.12, knee 170°)
 *   500–800 ms: on box/abs   (hipYOffset -0.06, knee 90°)   ← above baseline, stays in LANDING/ABSORBING
 *   800–1800 ms: standing    (hipYOffset  0.00, knee 170°)  ← returns to baseline → REP COMPLETE
 *
 * Rep duration from LOADING entry to STANDING return: 800ms > MIN_REP_DURATION_MS=600ms.
 * Max hip rise: 0.12 normalised units > MIN_HIP_RISE=0.06.
 *
 * Geometry note: kneeAngleDeg is the INCLUDED angle (not flexion).
 *   kneeAngleDeg=170 → nearly straight (standing)
 *   kneeAngleDeg=90  → right-angle bend → kneeFlexionDeg≈39° (good absorption)
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildBoxJumpPose } from '../../harness/pose-stub';
import { runBoxJumpSession, warningsOtherThan } from '../../harness/runner';
import type { BoxJumpPoseIntent } from '../../harness/types';

function happyPathIntent(reps: number) {
  const calMs = 800;
  const repCycleMs = 1800;
  const totalMs = calMs + reps * repCycleMs;

  return {
    totalMs,
    intentAt: (tMs: number): BoxJumpPoseIntent => {
      if (tMs < calMs) {
        // Calibration: stand upright, side-on
        return { hipYOffset: 0, kneeAngleDeg: 170 };
      }
      const tInRep = (tMs - calMs) % repCycleMs;
      if (tInRep < 200) {
        // Loading dip: hip drops, knee bends
        return { hipYOffset: 0.06, kneeAngleDeg: 130 };
      }
      if (tInRep < 500) {
        // Airborne: hip rises rapidly above baseline
        return { hipYOffset: -0.12, kneeAngleDeg: 170 };
      }
      if (tInRep < 800) {
        // On box absorbing: hip still above baseline (−0.06 > STANDING_TOLERANCE=0.05)
        // Knee bent at right angle (good absorption)
        return { hipYOffset: -0.06, kneeAngleDeg: 90 };
      }
      // Standing on box / returning to baseline
      return { hipYOffset: 0, kneeAngleDeg: 170 };
    },
  };
}

describe('Box Jump — happy path', () => {
  it('calibrates within 500ms', () => {
    const { totalMs, intentAt } = happyPathIntent(1);
    const frames = buildFrames(intentAt, buildBoxJumpPose, { fps: 30, durationMs: totalMs });
    const result = runBoxJumpSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).not.toBeNull();
    expect(result.calibrationConfirmedAtMs!).toBeLessThanOrEqual(500);
  });

  it('counts 3 clean reps', () => {
    const { totalMs, intentAt } = happyPathIntent(3);
    const frames = buildFrames(intentAt, buildBoxJumpPose, { fps: 30, durationMs: totalMs });
    const result = runBoxJumpSession(frames);
    expect(result.completedReps.length).toBe(3);
  });

  it('counts 5 clean reps', () => {
    const { totalMs, intentAt } = happyPathIntent(5);
    const frames = buildFrames(intentAt, buildBoxJumpPose, { fps: 30, durationMs: totalMs });
    const result = runBoxJumpSession(frames);
    expect(result.completedReps.length).toBe(5);
  });

  it('produces zero form warnings on clean reps', () => {
    const { totalMs, intentAt } = happyPathIntent(3);
    const frames = buildFrames(intentAt, buildBoxJumpPose, { fps: 30, durationMs: totalMs });
    const result = runBoxJumpSession(frames);
    const nonIdleWarnings = warningsOtherThan(result, 'not-moving');
    expect(nonIdleWarnings.length).toBe(0);
  });

  it('MQS is between 0 and 100 for each rep', () => {
    const { totalMs, intentAt } = happyPathIntent(3);
    const frames = buildFrames(intentAt, buildBoxJumpPose, { fps: 30, durationMs: totalMs });
    const result = runBoxJumpSession(frames);
    for (const rep of result.completedReps) {
      expect(rep.mqs).toBeGreaterThanOrEqual(0);
      expect(rep.mqs).toBeLessThanOrEqual(100);
    }
  });

  it('depthDeg (hip rise) reflects peak jump height', () => {
    const { totalMs, intentAt } = happyPathIntent(2);
    const frames = buildFrames(intentAt, buildBoxJumpPose, { fps: 30, durationMs: totalMs });
    const result = runBoxJumpSession(frames);
    for (const rep of result.completedReps) {
      // depthDeg stores the normalised hip rise — target is 0.12 > MIN_HIP_RISE=0.06
      expect(rep.depthDeg).toBeGreaterThan(0.05);
    }
  });
});
