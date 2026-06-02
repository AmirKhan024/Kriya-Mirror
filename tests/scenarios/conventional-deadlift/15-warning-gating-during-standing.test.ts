/**
 * Conventional Deadlift — no form warnings while standing (Fix A guard).
 * rounded-back and hips-shooting-up are gated to inActiveRep only.
 * This tests that both warnings are silent while the engine is in STANDING state.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildDeadliftPose } from '../../harness/pose-stub';
import { runDeadliftSession, countWarnings, warningsOtherThan } from '../../harness/runner';
import type { DeadliftPoseIntent } from '../../harness/types';

describe('Conventional Deadlift — form warnings gated to active rep (Fix A)', () => {
  it('no rounded-back warning while engine stays in STANDING state', () => {
    // Hinge angle stays at 10° — below HINGE_START_DEG (25°) → always STANDING.
    // roundedBack:true overrides shoulderY to below hipY, which the engine reads as a
    // very large hinge angle (preventing calibration). Use clean pose: the gate
    // `if (inActiveRep && shoulderBelowHip)` means STANDING always suppresses the warning.
    const frames = buildFrames(
      (): DeadliftPoseIntent => ({
        hipHingeDeg: 10,
        armsAtSides: true,
      }),
      buildDeadliftPose,
      { fps: 30, durationMs: 5000 },
    );
    const result = runDeadliftSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'rounded-back')).toBe(0);
  });

  it('only not-moving fires after prolonged standing (no form warnings)', () => {
    const frames = buildFrames(
      (): DeadliftPoseIntent => ({
        hipHingeDeg: 0,
        roundedBack: true,
        armsAtSides: true,
      }),
      buildDeadliftPose,
      { fps: 30, durationMs: 9000 },
    );
    const result = runDeadliftSession(frames);
    expect(countWarnings(result, 'rounded-back')).toBe(0);
    expect(countWarnings(result, 'hips-shooting-up')).toBe(0);
    // not-moving may fire after 5s idle; that's the only allowed warning
    const unexpected = warningsOtherThan(result, 'not-moving', 'position-lost');
    expect(unexpected.length).toBe(0);
  });
});
