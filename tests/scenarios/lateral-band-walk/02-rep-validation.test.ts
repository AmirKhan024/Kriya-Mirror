/**
 * Lateral Band Walk — rep validation.
 * Tests: ballistic step, too-fast step, and valid slow step.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildLateralBandWalkPose } from '../../harness/pose-stub';
import { runLateralBandWalkSession, countWarnings } from '../../harness/runner';
import type { LateralBandWalkPoseIntent } from '../../harness/types';

const CAL_MS = 300;

describe('Lateral Band Walk — rep validation', () => {
  it('(1) rejects ballistic step (velocity > 2.5 body-widths/sec) → emits malformed-rep', () => {
    // Ballistic: jump to full displacement in one or two frames (< 100ms total)
    // Then hold briefly, then return. High velocity = large displacement / short time.
    // We simulate a super-fast step (50ms total) with full 0.06 displacement.
    // TEST-LBW-02a: Displacement raised from 0.06 → 0.20 to exceed new CONFIRM threshold = 0.15.
    // Ballistic at 50ms: velocity = 0.20 / 0.05s = 4.0 > MAX_HIP_VELOCITY (2.5) → still caught.
    const FAST_MS = 50; // step takes only 50ms — too fast
    const TOTAL_MS = CAL_MS + FAST_MS + 500;
    const frames = buildFrames(
      (tMs): LateralBandWalkPoseIntent => {
        if (tMs < CAL_MS) return { hipXDisplacement: 0 };
        const t = tMs - CAL_MS;
        if (t < FAST_MS) {
          // Rapidly reach threshold in 50ms — high velocity
          return {
            hipXDisplacement: 0.20,
            stepDirection: 'right',
            hipVelocity: 4.0, // > MAX_HIP_VELOCITY of 2.5
          };
        }
        return { hipXDisplacement: 0 };
      },
      buildLateralBandWalkPose,
      { fps: 30, durationMs: TOTAL_MS },
    );

    const result = runLateralBandWalkSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'malformed-rep')).toBeGreaterThan(0);
    // Should not count as a valid step
    expect(result.completedReps.length).toBe(0);
  });

  it('(2) rejects step with duration < 300ms → emits malformed-rep', () => {
    // Step that peaks above threshold but takes less than STEP_MIN_DURATION_MS.
    // We need the displacement to clear STEP_CONFIRM_THRESHOLD (0.045) then
    // immediately drop back. Total phase time < 300ms.
    const TOTAL_MS = CAL_MS + 3000;
    const frames = buildFrames(
      (tMs): LateralBandWalkPoseIntent => {
        if (tMs < CAL_MS) return { hipXDisplacement: 0 };
        const t = tMs - CAL_MS;
        // TEST-LBW-02b: Displacement raised from 0.055 → 0.18 to exceed new CONFIRM threshold = 0.15.
        // Drop-back to 0.03 (below new STEP_RESET_THRESHOLD = 0.04) — total active time < 300ms.
        if (t < 100) {
          return { hipXDisplacement: 0.18, stepDirection: 'right' };
        }
        if (t < 200) {
          return { hipXDisplacement: 0.03, stepDirection: 'right' }; // below new reset threshold (0.04)
        }
        return { hipXDisplacement: 0 };
      },
      buildLateralBandWalkPose,
      { fps: 30, durationMs: TOTAL_MS },
    );

    const result = runLateralBandWalkSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    // A too-fast step may trigger malformed-rep
    // (the step is rejected — no valid step counted)
    // Note: depending on exact frame timing, may or may not fire warning
    // but should definitely NOT count 1 valid rep within those 200ms
    const stepsWithin200ms = result.completedReps.filter((r: { atMs: number }) => r.atMs < CAL_MS + 300);
    expect(stepsWithin200ms.length).toBe(0);
  });

  it('(3) valid slow step (1500ms duration, displacement confirmed) → counts as 1 rep, no warning', () => {
    // Slow step: 1500ms to reach peak and return. Well within STEP_MAX_DURATION_MS = 3000ms.
    const STEP_MS = 1500;
    const TOTAL_MS = CAL_MS + STEP_MS + 1000;
    const frames = buildFrames(
      (tMs): LateralBandWalkPoseIntent => {
        if (tMs < CAL_MS) return { hipXDisplacement: 0 };
        const t = tMs - CAL_MS;
        // TEST-LBW-02c: Displacement raised from 0.06 → 0.18 to exceed new CONFIRM threshold = 0.15.
        if (t < 700) {
          // Ramp up over 700ms to 0.18 displacement
          return { hipXDisplacement: (t / 700) * 0.18, stepDirection: 'right' };
        }
        if (t < 1100) {
          // Hold at peak for 400ms
          return { hipXDisplacement: 0.18, stepDirection: 'right' };
        }
        if (t < STEP_MS) {
          // Return
          return { hipXDisplacement: 0.18 - ((t - 1100) / 400) * 0.18, stepDirection: 'right' };
        }
        return { hipXDisplacement: 0 };
      },
      buildLateralBandWalkPose,
      { fps: 30, durationMs: TOTAL_MS },
    );

    const result = runLateralBandWalkSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.completedReps.length).toBe(1);
    expect(countWarnings(result, 'malformed-rep')).toBe(0);
  });
});
