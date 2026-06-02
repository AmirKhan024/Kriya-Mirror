/**
 * Kettlebell Swing — form warnings are silent during idle STANDING state.
 * Fix A: squat-pattern and arm-lift are gated to inActiveRep (repState !== 'STANDING').
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildKBSwingPose } from '../../harness/pose-stub';
import { runKBSwingSession, countWarnings, warningsOtherThan } from '../../harness/runner';
import type { KBSwingPoseIntent } from '../../harness/types';

const CAL_MS = 1000;

describe('Kettlebell Swing — form warnings silent during STANDING idle', () => {
  it('only allows tracking-validity warnings during idle STANDING', () => {
    // Calibrate clean, then stay standing with form errors — no rep → no form warnings
    const TOTAL_MS = CAL_MS + 6000;
    const frames = buildFrames(
      (tMs): KBSwingPoseIntent => {
        if (tMs < CAL_MS) {
          // Clean calibration
          return { hipHingeDeg: 0, extraKneeBend: 0, armLift: false };
        }
        // Post-cal: form errors while STANDING (no hinge → no active rep)
        return {
          hipHingeDeg: 0,
          extraKneeBend: 30,  // would be squat-pattern if active rep
          armLift: true,      // would be arm-lift if active rep
        };
      },
      buildKBSwingPose,
      { fps: 30, durationMs: TOTAL_MS },
    );

    const result = runKBSwingSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');

    // No form warnings (squat-pattern or arm-lift) — only tracking ones allowed
    expect(countWarnings(result, 'squat-pattern')).toBe(0);
    expect(countWarnings(result, 'arm-lift')).toBe(0);

    // Only not-moving or position-lost may fire
    const formWarnings = warningsOtherThan(result, 'not-moving', 'position-lost', 'too-close', 'too-far');
    expect(formWarnings.length).toBe(0);
  });
});
