/**
 * Regression test for Dead Bug Fix A — form warnings are gated while the engine
 * is in the AT_REST state.
 *
 * During rest (tabletop position, legExtensionDeg ≈ 0) any transient
 * hip-lift-off signal must NOT produce a warning. Emitting form coaching cues
 * while the user is between reps is noisy and confusing.
 *
 * Spec: onPostureWarning('hip-lift-off') must never fire while the engine
 * state is AT_REST, regardless of the hipLiftAmount value.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildDeadBugPose } from '../../harness/pose-stub';
import { runDeadBugSession, countWarnings } from '../../harness/runner';
import type { DeadBugPoseIntent } from '../../harness/types';

describe('Dead Bug — regression: hip-lift-off suppressed during AT_REST (Fix A)', () => {
  it('does NOT fire hip-lift-off while user holds tabletop rest pose', () => {
    // Calibrate, then hold tabletop (legExtensionDeg=0) with hipLiftAmount=0.05
    // for several seconds. hip-lift-off threshold is 0.04, so this would fire
    // if the AT_REST gate were absent.
    const frames = buildFrames(
      () =>
        ({
          legExtensionDeg: 0,
          armsUp: true,
          hipLiftAmount: 0.05, // above the 0.04 threshold — should still be silenced
        } as DeadBugPoseIntent),
      buildDeadBugPose,
      { fps: 30, durationMs: 5000 },
    );

    const result = runDeadBugSession(frames);

    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'hip-lift-off')).toBe(0);
  });

  it('DOES fire hip-lift-off once the leg starts extending (active rep phase)', () => {
    // Calibrate, then immediately start extending while applying hipLiftAmount=0.06.
    // The engine should leave AT_REST and the warning should be permitted.
    const CAL_MS = 2200;
    const TOTAL_MS = CAL_MS + 3000;

    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) {
          return {
            legExtensionDeg: 0,
            armsUp: true,
          } as DeadBugPoseIntent;
        }
        const tInRep = tMs - CAL_MS;
        const legExtensionDeg = Math.min(60, (tInRep / 1500) * 60);
        return {
          legExtensionDeg,
          armsUp: true,
          hipLiftAmount: 0.06, // clearly above threshold
        } as DeadBugPoseIntent;
      },
      buildDeadBugPose,
      { fps: 30, durationMs: TOTAL_MS },
    );

    const result = runDeadBugSession(frames);

    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'hip-lift-off')).toBeGreaterThanOrEqual(1);
  });
});
