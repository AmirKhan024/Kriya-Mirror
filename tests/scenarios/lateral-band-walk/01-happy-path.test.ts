/**
 * Lateral Band Walk — happy path.
 * 10 clean lateral steps (alternating left/right) count correctly.
 * No form warnings emitted.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildLateralBandWalkPose } from '../../harness/pose-stub';
import { runLateralBandWalkSession, warningsOtherThan } from '../../harness/runner';
import type { LateralBandWalkPoseIntent } from '../../harness/types';

// Calibration: 300ms (feet hip-width, hands on hips, good distance)
// Each step cycle:
//   0–600ms  : displace hip in step direction (0 → 0.18 body-width)
//   600–900ms: hold at peak displacement (> 15% body-width)
//   900–1200ms: return hip toward center (0.18 → 0)
// TEST-LBW-01: Displacement raised from 0.06 → 0.18 to exceed new
// STEP_CONFIRM_THRESHOLD = 0.15 (was 0.045).
// Note: STEP_MIN_DURATION_MS = 300ms so 600ms hold qualifies.
const CAL_MS = 300;
const STEP_CYCLE_MS = 1500;

function happyPathIntent(stepCount: number) {
  const totalMs = CAL_MS + stepCount * STEP_CYCLE_MS + 500;
  const intentAt = (tMs: number): LateralBandWalkPoseIntent => {
    if (tMs < CAL_MS) {
      return { hipXDisplacement: 0 };
    }
    const stepIndex = Math.floor((tMs - CAL_MS) / STEP_CYCLE_MS);
    const stepDir = (stepIndex % 2 === 0 ? 'right' : 'left') as 'left' | 'right';
    const tInStep = (tMs - CAL_MS) % STEP_CYCLE_MS;

    let displacement: number;
    if (tInStep < 600) {
      // Moving out: 0 → 0.18 (above new STEP_CONFIRM_THRESHOLD = 0.15)
      displacement = (tInStep / 600) * 0.18;
    } else if (tInStep < 900) {
      // Hold at peak
      displacement = 0.18;
    } else {
      // Return toward center
      displacement = 0.18 - ((tInStep - 900) / 600) * 0.18;
    }
    return {
      hipXDisplacement: stepDir === 'right' ? displacement : -displacement,
      stepDirection: stepDir,
    };
  };
  return { totalMs, intentAt };
}

describe('Lateral Band Walk — happy path', () => {
  it('calibrates and counts 10 clean steps with no form warnings', () => {
    const { totalMs, intentAt } = happyPathIntent(10);
    const frames = buildFrames(intentAt, buildLateralBandWalkPose, { fps: 30, durationMs: totalMs });
    const result = runLateralBandWalkSession(frames);

    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThanOrEqual(500);
    expect(result.completedReps.length).toBe(10);
    expect(warningsOtherThan(result, 'not-moving').length).toBe(0);
  });

  it('counts 5 steps when given a 5-step stream', () => {
    const { totalMs, intentAt } = happyPathIntent(5);
    const frames = buildFrames(intentAt, buildLateralBandWalkPose, { fps: 30, durationMs: totalMs });
    const result = runLateralBandWalkSession(frames);

    expect(result.completedReps.length).toBe(5);
  });

  it('all completed steps have positive MQS', () => {
    const { totalMs, intentAt } = happyPathIntent(3);
    const frames = buildFrames(intentAt, buildLateralBandWalkPose, { fps: 30, durationMs: totalMs });
    const result = runLateralBandWalkSession(frames);

    expect(result.completedReps.length).toBeGreaterThan(0);
    for (const rep of result.completedReps) {
      expect(rep.mqs).toBeGreaterThan(0);
    }
  });

  it('frame metrics calibrated flag becomes true after calibration', () => {
    const { totalMs, intentAt } = happyPathIntent(2);
    const frames = buildFrames(intentAt, buildLateralBandWalkPose, { fps: 30, durationMs: totalMs });
    const result = runLateralBandWalkSession(frames);

    // After calibration, all frame metrics should have calibrated = true
    const postCalFrames = result.frameMetricsSamples.filter((m: { calibrated: boolean }) => m.calibrated);
    expect(postCalFrames.length).toBeGreaterThan(0);
  });
});
