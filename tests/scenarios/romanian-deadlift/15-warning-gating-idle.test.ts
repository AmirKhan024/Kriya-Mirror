/**
 * Romanian Deadlift — form warnings are silent during STANDING state (idle).
 * Verifies Fix A applies equally to idle standing between reps.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildRomanianDeadliftPose } from '../../harness/pose-stub';
import { runRDLSession, countWarnings } from '../../harness/runner';
import type { RomanianDeadliftPoseIntent } from '../../harness/types';

describe('Romanian Deadlift — form warning gating during idle standing', () => {
  it('rdl-back-rounded is not fired when standing still between reps', () => {
    // Engine in STANDING state throughout — form warnings must be silent
    const frames = buildFrames(
      (): RomanianDeadliftPoseIntent => ({
        hipHingeDeg: 5, // well below HINGE_START (20°)
        kneeAngleDeg: 15,
      }),
      buildRomanianDeadliftPose,
      { fps: 30, durationMs: 6000 },
    );
    const result = runRDLSession(frames);

    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'rdl-back-rounded')).toBe(0);
  });

  it('excessive-knee-bend is not fired when standing still between reps', () => {
    const frames = buildFrames(
      (): RomanianDeadliftPoseIntent => ({
        hipHingeDeg: 5,
        kneeAngleDeg: 15,
        extraKneeBend: 35, // large bend — would fire during rep
      }),
      buildRomanianDeadliftPose,
      { fps: 30, durationMs: 6000 },
    );
    const result = runRDLSession(frames);

    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'excessive-knee-bend')).toBe(0);
  });
});
