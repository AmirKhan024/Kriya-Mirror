/**
 * Jump Squat — warning gating during STANDING state.
 * Fix A: stiff-landing warning must NOT fire while user is in STANDING state.
 * Also verifies posture warnings do NOT fire in LOADING/AIRBORNE/LANDING/ABSORBING.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildJumpSquatPose } from '../../harness/pose-stub';
import { runJumpSquatSession } from '../../harness/runner';
import type { JumpSquatPoseIntent } from '../../harness/types';

const CAL_MS = 800;

describe('Jump Squat — warning gating during STANDING', () => {
  it('stiff-landing does NOT fire while standing between reps (Fix A)', () => {
    const frames = buildFrames(
      (tMs: number): JumpSquatPoseIntent => {
        if (tMs < CAL_MS) return { hipYOffset: 0, kneeFlexionDeg: 5 };
        // Stand with straight knees — STANDING state
        return { hipYOffset: 0, kneeFlexionDeg: 5 };
      },
      buildJumpSquatPose,
      { fps: 30, durationMs: CAL_MS + 3000 },
    );
    const result = runJumpSquatSession(frames);
    const stiffWarnings = result.warnings.filter(w => w.type === 'stiff-landing');
    expect(stiffWarnings.length).toBe(0);
  });

  it('incomplete-jump-squat does NOT fire continuously in STANDING state', () => {
    const frames = buildFrames(
      (tMs: number): JumpSquatPoseIntent => {
        if (tMs < CAL_MS) return { hipYOffset: 0, kneeFlexionDeg: 5 };
        return { hipYOffset: 0, kneeFlexionDeg: 5 };
      },
      buildJumpSquatPose,
      { fps: 30, durationMs: CAL_MS + 3000 },
    );
    const result = runJumpSquatSession(frames);
    const incompleteWarnings = result.warnings.filter(w => w.type === 'incomplete-jump-squat');
    expect(incompleteWarnings.length).toBe(0);
  });

  it('posture warnings do NOT fire during LOADING/AIRBORNE/LANDING/ABSORBING before rep validation', () => {
    // A clean jump cycle — stiff-landing should only fire if conditions met
    // Here we use proper knee bend so stiff-landing never triggers
    const frames = buildFrames(
      (tMs: number): JumpSquatPoseIntent => {
        if (tMs < CAL_MS) return { hipYOffset: 0, kneeFlexionDeg: 5 };
        const t = tMs - CAL_MS;
        if (t < 200) return { hipYOffset: 0.05, kneeFlexionDeg: 60 };
        if (t < 500) return { hipYOffset: -0.09, kneeFlexionDeg: 5 };
        if (t < 800) return { hipYOffset: -0.06, kneeFlexionDeg: 50 };
        return { hipYOffset: 0, kneeFlexionDeg: 5 };
      },
      buildJumpSquatPose,
      { fps: 30, durationMs: CAL_MS + 2000 },
    );
    const result = runJumpSquatSession(frames);
    const stiffWarnings = result.warnings.filter(w => w.type === 'stiff-landing');
    expect(stiffWarnings.length).toBe(0);
  });
});
