/**
 * Lateral Band Walk — warning gating (Fix A).
 * trunk-lean and hip-drop warnings must NOT fire while stepState = 'STANDING_STILL'.
 * They SHOULD fire when STEPPING_OUT or STEP_CONFIRMED.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildLateralBandWalkPose } from '../../harness/pose-stub';
import { runLateralBandWalkSession, countWarnings } from '../../harness/runner';
import type { LateralBandWalkPoseIntent } from '../../harness/types';

const CAL_MS = 300;

describe('Lateral Band Walk — warning gating (Fix A)', () => {
  it('trunk-lean does NOT fire during STANDING_STILL phase (no step in progress)', () => {
    // User stands still after calibration — no hip displacement — with bad trunk lean.
    // Since no step is in progress (STANDING_STILL), trunk-lean should NOT fire.
    const TOTAL_MS = CAL_MS + 3000;
    const frames = buildFrames(
      (tMs): LateralBandWalkPoseIntent => {
        if (tMs < CAL_MS) return { hipXDisplacement: 0 };
        // No displacement (< STEP_ENTER_THRESHOLD = 0.025) = STANDING_STILL
        // but with bad trunk lean — should NOT trigger warning in STANDING_STILL
        return { hipXDisplacement: 0.01, trunkLeanDeg: 40 };
      },
      buildLateralBandWalkPose,
      { fps: 30, durationMs: TOTAL_MS },
    );

    const result = runLateralBandWalkSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'trunk-lean')).toBe(0);
  });

  it('hip-drop does NOT fire during STANDING_STILL phase', () => {
    // User stands still — no step — hip drop injected. Should NOT fire.
    const TOTAL_MS = CAL_MS + 3000;
    const frames = buildFrames(
      (tMs): LateralBandWalkPoseIntent => {
        if (tMs < CAL_MS) return { hipXDisplacement: 0 };
        return { hipXDisplacement: 0.01, hipDropRatio: 0.10 }; // no step in progress
      },
      buildLateralBandWalkPose,
      { fps: 30, durationMs: TOTAL_MS },
    );

    const result = runLateralBandWalkSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'hip-drop')).toBe(0);
  });

  it('trunk-lean DOES fire when sustained during an active step', () => {
    // Clear step with sustained trunk lean > 30° for 8+ frames during STEPPING_OUT.
    const STEP_MS = 1500;
    const TOTAL_MS = CAL_MS + STEP_MS + 500;
    const frames = buildFrames(
      (tMs): LateralBandWalkPoseIntent => {
        if (tMs < CAL_MS) return { hipXDisplacement: 0 };
        const t = tMs - CAL_MS;
        if (t < STEP_MS) {
          // Displacement raised to 0.18 to exceed new STEP_CONFIRM_THRESHOLD=0.15
          const displacement = t < 750
            ? (t / 750) * 0.18
            : 0.18 - ((t - 750) / 750) * 0.18;
          return {
            hipXDisplacement: displacement,
            stepDirection: 'right',
            trunkLeanDeg: 45, // consistently > 30° during step
          };
        }
        return { hipXDisplacement: 0 };
      },
      buildLateralBandWalkPose,
      { fps: 30, durationMs: TOTAL_MS },
    );

    const result = runLateralBandWalkSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'trunk-lean')).toBeGreaterThan(0);
  });

  it('steps-not-tracked IS allowed to fire regardless of step state (ungated)', () => {
    // Frame-edge warning fires even without an active step.
    const TOTAL_MS = CAL_MS + 2000;
    const frames = buildFrames(
      (tMs): LateralBandWalkPoseIntent => {
        if (tMs < CAL_MS) return { hipXDisplacement: 0 };
        // Standing still (no step) but near frame edge
        return { hipXDisplacement: 0, isNearEdge: true };
      },
      buildLateralBandWalkPose,
      { fps: 30, durationMs: TOTAL_MS },
    );

    const result = runLateralBandWalkSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    // steps-not-tracked is ungated — fires even during STANDING_STILL
    expect(countWarnings(result, 'steps-not-tracked')).toBeGreaterThan(0);
  });
});
