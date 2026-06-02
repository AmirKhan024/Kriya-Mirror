/**
 * Jump Squat — posture warnings.
 * Tests that stiff-landing fires when knee stays unbent during landing.
 * Fix A: warnings are gated to active rep phase (not STANDING).
 *
 * Key geometry constraint: STANDING_TOLERANCE=0.04 (normalised units).
 * Landing hipYOffset must have |hipYOffset| >= 0.05 so the rep stays in
 * LANDING/ABSORBING long enough for stiff-landing to accumulate 300ms.
 * Using hipYOffset=-0.05 keeps |hipDisp|=0.05>0.04 → rep doesn't complete
 * until hipYOffset returns to 0.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildJumpSquatPose } from '../../harness/pose-stub';
import { runJumpSquatSession } from '../../harness/runner';
import type { JumpSquatPoseIntent } from '../../harness/types';

const CAL_MS = 800;

describe('Jump Squat — posture warnings', () => {
  it('fires stiff-landing when knees stay unbent >300ms after landing', () => {
    // hipYOffset=-0.05: |hipDisp|=0.05>STANDING_TOLERANCE=0.04 keeps rep in LANDING.
    // kneeFlex=5 ≈ 5° < STIFF_LANDING_THRESHOLD=20° → stiff timer accumulates.
    // After 300ms stiff-landing fires.
    const frames = buildFrames(
      (tMs: number): JumpSquatPoseIntent => {
        if (tMs < CAL_MS) return { hipYOffset: 0, kneeFlexionDeg: 5 };
        const t = tMs - CAL_MS;
        if (t < 200) return { hipYOffset: 0.05, kneeFlexionDeg: 60 };
        if (t < 500) return { hipYOffset: -0.09, kneeFlexionDeg: 5 };
        // Landing with stiff knees for 600ms — |hipDisp|=0.05 > STANDING_TOLERANCE so rep stays active
        if (t < 1100) return { hipYOffset: -0.05, kneeFlexionDeg: 5 };
        if (t < 1500) return { hipYOffset: 0, kneeFlexionDeg: 5 };
        return { hipYOffset: 0, kneeFlexionDeg: 5 };
      },
      buildJumpSquatPose,
      { fps: 30, durationMs: CAL_MS + 2200 },
    );
    const result = runJumpSquatSession(frames);
    const stiffWarnings = result.warnings.filter(w => w.type === 'stiff-landing');
    expect(stiffWarnings.length).toBeGreaterThan(0);
  });

  it('does NOT fire stiff-landing when knees bend sufficiently on landing', () => {
    // kneeFlex=50 ≈ 46° > STIFF_LANDING_THRESHOLD=20° → stiff timer never starts.
    // hipYOffset=-0.06: |hipDisp|=0.06>0.04 → ABSORBING phase entered (knee flex > 20).
    const frames = buildFrames(
      (tMs: number): JumpSquatPoseIntent => {
        if (tMs < CAL_MS) return { hipYOffset: 0, kneeFlexionDeg: 5 };
        const t = tMs - CAL_MS;
        if (t < 200) return { hipYOffset: 0.05, kneeFlexionDeg: 60 };
        if (t < 500) return { hipYOffset: -0.09, kneeFlexionDeg: 5 };
        if (t < 900) return { hipYOffset: -0.06, kneeFlexionDeg: 50 };
        if (t < 1300) return { hipYOffset: 0, kneeFlexionDeg: 5 };
        return { hipYOffset: 0, kneeFlexionDeg: 5 };
      },
      buildJumpSquatPose,
      { fps: 30, durationMs: CAL_MS + 1600 },
    );
    const result = runJumpSquatSession(frames);
    const stiffWarnings = result.warnings.filter(w => w.type === 'stiff-landing');
    expect(stiffWarnings.length).toBe(0);
  });

  it('does NOT fire stiff-landing while user is in STANDING state between reps', () => {
    // Between reps: user stands with knees straight — should not trigger stiff-landing (Fix A)
    const frames = buildFrames(
      (tMs: number): JumpSquatPoseIntent => {
        if (tMs < CAL_MS) return { hipYOffset: 0, kneeFlexionDeg: 5 };
        return { hipYOffset: 0, kneeFlexionDeg: 5 };
      },
      buildJumpSquatPose,
      { fps: 30, durationMs: CAL_MS + 4000 },
    );
    const result = runJumpSquatSession(frames);
    const stiffWarnings = result.warnings.filter(w => w.type === 'stiff-landing');
    expect(stiffWarnings.length).toBe(0);
  });
});
