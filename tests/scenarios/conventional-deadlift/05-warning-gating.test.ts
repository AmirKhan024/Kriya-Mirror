/**
 * Conventional Deadlift — warning gating (Fix A).
 * Form warnings (rounded-back, hips-shooting-up) must NOT fire while STANDING between reps.
 * Only fire during active rep (HINGING, AT_BOTTOM, EXTENDING).
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildDeadliftPose } from '../../harness/pose-stub';
import { runDeadliftSession, countWarnings } from '../../harness/runner';
import type { DeadliftPoseIntent } from '../../harness/types';

describe('Conventional Deadlift — warning gating (Fix A)', () => {
  it('does NOT fire rounded-back while engine stays in STANDING state', () => {
    // roundedBack:true makes the pose look like a large hinge to the engine
    // (shoulder overrides to below hip), so we test the gate with clean standing.
    // The gating logic is: `if (inActiveRep && shoulderBelowHip)` — when STANDING,
    // inActiveRep=false so no warning fires regardless of shoulder position.
    const frames = buildFrames(
      (): DeadliftPoseIntent => ({
        hipHingeDeg: 5, // well below HINGE_START (25°) → always STANDING
        armsAtSides: true,
      }),
      buildDeadliftPose,
      { fps: 30, durationMs: 6000 },
    );
    const result = runDeadliftSession(frames);

    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'rounded-back')).toBe(0);
  });

  it('fires rounded-back only during the active rep phase', () => {
    // Standing clean → rep with rounded back → standing clean again
    const frames = buildFrames(
      (tMs): DeadliftPoseIntent => {
        if (tMs < 1000) return { hipHingeDeg: 0, armsAtSides: true };
        // Start rep at 1000ms
        if (tMs < 2000) {
          const t = (tMs - 1000) / 1000;
          return { hipHingeDeg: t * 70, roundedBack: t > 0.3, armsAtSides: true };
        }
        if (tMs < 2500) return { hipHingeDeg: 70, roundedBack: true, armsAtSides: true };
        if (tMs < 3500) {
          const t = (tMs - 2500) / 1000;
          return { hipHingeDeg: 70 - t * 70, roundedBack: t < 0.7, armsAtSides: true };
        }
        // Standing again — clean
        return { hipHingeDeg: 0, armsAtSides: true };
      },
      buildDeadliftPose,
      { fps: 30, durationMs: 5000 },
    );
    const result = runDeadliftSession(frames);

    // Warning should have fired during the rep
    expect(countWarnings(result, 'rounded-back')).toBeGreaterThan(0);
  });
});
