/**
 * Kettlebell Swing — warning gating during STANDING idle state.
 * Fix A: squat-pattern and arm-lift warnings must NOT fire while repState === 'STANDING'.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildKBSwingPose } from '../../harness/pose-stub';
import { runKBSwingSession, countWarnings } from '../../harness/runner';
import type { KBSwingPoseIntent } from '../../harness/types';

const CAL_MS = 1000;

describe('Kettlebell Swing — warning gating during STANDING', () => {
  it('does NOT fire squat-pattern while user is idle in STANDING state', () => {
    // Calibrate with good pose, then stand idle with extra knee bend.
    // User is always in STANDING state. squat-pattern must be gated.
    const TOTAL_MS = CAL_MS + 5000;
    const frames = buildFrames(
      (tMs): KBSwingPoseIntent => {
        if (tMs < CAL_MS) {
          // Clean calibration pose (no extra knee bend)
          return { hipHingeDeg: 0, extraKneeBend: 0 };
        }
        // Post-cal: idle with extra knee bend — but still in STANDING state
        return { hipHingeDeg: 0, extraKneeBend: 30 };
      },
      buildKBSwingPose,
      { fps: 30, durationMs: TOTAL_MS },
    );

    const result = runKBSwingSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    // Fix A: gated — zero squat-pattern warnings when not in active rep
    expect(countWarnings(result, 'squat-pattern')).toBe(0);
  });

  it('does NOT fire arm-lift while user is idle in STANDING state', () => {
    // Calibrate with good pose, then stand idle with arms raised.
    // User is always in STANDING state. arm-lift must be gated.
    const TOTAL_MS = CAL_MS + 5000;
    const frames = buildFrames(
      (tMs): KBSwingPoseIntent => {
        if (tMs < CAL_MS) {
          // Clean calibration pose (arms at sides)
          return { hipHingeDeg: 0, armLift: false };
        }
        // Post-cal: idle with arms raised — but still in STANDING state
        return { hipHingeDeg: 0, armLift: true };
      },
      buildKBSwingPose,
      { fps: 30, durationMs: TOTAL_MS },
    );

    const result = runKBSwingSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    // Fix A: gated — zero arm-lift warnings when not in active rep
    expect(countWarnings(result, 'arm-lift')).toBe(0);
  });
});
