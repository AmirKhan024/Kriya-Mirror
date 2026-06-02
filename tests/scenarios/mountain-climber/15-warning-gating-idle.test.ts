/**
 * Mountain Climber — warning gating: form warnings silent while PLANK (Fix A)
 *
 * Comprehensive test that verifies form warnings (hip-sag, hip-pike) are
 * completely silent while the rep state is PLANK, regardless of how long
 * the user has been in the plank or how severe the hip deviation is.
 *
 * This is a companion to 05-warning-gating-during-plank.test.ts, focusing
 * on the scenario where deviations occur for a long time in PLANK state.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildMountainClimberPose } from '../../harness/pose-stub';
import { runMountainClimberSession, countWarnings } from '../../harness/runner';
import type { MountainClimberPoseIntent } from '../../harness/types';

const CAL_MS = 500;

describe('Mountain Climber — form warnings gated to active reps only', () => {
  it('no hip-sag or hip-pike warnings accumulate during extended PLANK idle', () => {
    // 10 seconds of PLANK with severe hip deviation — zero form warnings
    const TOTAL_MS = CAL_MS + 10_000;
    const frames = buildFrames(
      (tMs): MountainClimberPoseIntent => {
        // Calibration: clean form
        if (tMs < CAL_MS) return { kneeHipAngleDeg: 170, hipDeviation: 0, bodyLength: 0.55 };
        // Post-cal: angle always > DRIVE_ENTER_DEG (120°), so state stays PLANK
        // Deviation alternates sag / pike
        const sagOrPike = Math.sin(tMs / 500) > 0 ? 0.10 : -0.10;
        return { kneeHipAngleDeg: 162, hipDeviation: sagOrPike, bodyLength: 0.55 };
      },
      buildMountainClimberPose,
      { fps: 30, durationMs: TOTAL_MS },
    );
    const result = runMountainClimberSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'hip-sag')).toBe(0);
    expect(countWarnings(result, 'hip-pike')).toBe(0);
  });

  it('not-moving fires after 5s idle but no form warnings accumulate alongside it', () => {
    // 7 seconds PLANK with hip sag — not-moving fires, hip-sag does not
    const TOTAL_MS = CAL_MS + 7000;
    const frames = buildFrames(
      (tMs): MountainClimberPoseIntent => {
        if (tMs < CAL_MS) return { kneeHipAngleDeg: 170, hipDeviation: 0, bodyLength: 0.55 };
        return { kneeHipAngleDeg: 162, hipDeviation: 0.10, bodyLength: 0.55 };
      },
      buildMountainClimberPose,
      { fps: 30, durationMs: TOTAL_MS },
    );
    const result = runMountainClimberSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'not-moving')).toBeGreaterThanOrEqual(1);
    expect(countWarnings(result, 'hip-sag')).toBe(0);
  });
});
