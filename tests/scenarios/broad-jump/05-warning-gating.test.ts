/**
 * Broad Jump — warning gating during STANDING state.
 * Fix A: stiff-landing warning must NOT fire while user is in STANDING state.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildBroadJumpPose } from '../../harness/pose-stub';
import { runBroadJumpSession } from '../../harness/runner';
import type { BroadJumpPoseIntent } from '../../harness/types';

const CAL_MS = 800;

describe('Broad Jump — warning gating during STANDING', () => {
  it('stiff-landing does NOT fire while standing between reps (Fix A)', () => {
    const frames = buildFrames(
      (tMs: number): BroadJumpPoseIntent => {
        if (tMs < CAL_MS) return { hipYOffset: 0, kneeFlexionDeg: 5 };
        // Stand with straight knees — STANDING state
        return { hipYOffset: 0, kneeFlexionDeg: 5 };
      },
      buildBroadJumpPose,
      { fps: 30, durationMs: CAL_MS + 3000 },
    );
    const result = runBroadJumpSession(frames);
    const stiffWarnings = result.warnings.filter(w => w.type === 'stiff-landing');
    expect(stiffWarnings.length).toBe(0);
  });

  it('incomplete-jump does NOT fire continuously in STANDING state', () => {
    const frames = buildFrames(
      (tMs: number): BroadJumpPoseIntent => {
        if (tMs < CAL_MS) return { hipYOffset: 0, kneeFlexionDeg: 5 };
        return { hipYOffset: 0, kneeFlexionDeg: 5 };
      },
      buildBroadJumpPose,
      { fps: 30, durationMs: CAL_MS + 3000 },
    );
    const result = runBroadJumpSession(frames);
    const incompleteWarnings = result.warnings.filter(w => w.type === 'incomplete-jump');
    expect(incompleteWarnings.length).toBe(0);
  });
});
