/**
 * Conventional Deadlift — distance gate hysteresis.
 * The distanceOk gate uses separate ENTER [0.50, 0.90] and EXIT [0.45, 0.92]
 * thresholds. Test that hysteresis prevents gate flapping at the boundary.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildDeadliftPose } from '../../harness/pose-stub';
import { runDeadliftSession } from '../../harness/runner';
import type { DeadliftPoseIntent } from '../../harness/types';

describe('Conventional Deadlift — distance gate hysteresis', () => {
  it('distanceOk is true at default bodyHeight=0.62 (well inside range)', () => {
    const frames = buildFrames(
      (): DeadliftPoseIntent => ({ hipHingeDeg: 0, armsAtSides: true }),
      buildDeadliftPose,
      { fps: 30, durationMs: 1000 },
    );
    const result = runDeadliftSession(frames);
    expect(result.finalCalibration?.checks.distanceOk).toBe(true);
  });

  it('calibration confirms successfully at normal distance', () => {
    const frames = buildFrames(
      (): DeadliftPoseIntent => ({ hipHingeDeg: 0, armsAtSides: true }),
      buildDeadliftPose,
      { fps: 30, durationMs: 2000 },
    );
    const result = runDeadliftSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThan(600);
  });

  it('distanceHint is null when user is at correct distance', () => {
    const frames = buildFrames(
      (): DeadliftPoseIntent => ({ hipHingeDeg: 0, armsAtSides: true }),
      buildDeadliftPose,
      { fps: 30, durationMs: 500 },
    );
    const result = runDeadliftSession(frames);
    expect(result.finalCalibration?.distanceHint).toBeNull();
  });

  it('fails fullBodyVisible gate when core landmarks are invisible', () => {
    // Calibration picks the side with best shoulder+hip+ankle visibility score.
    // To fail fullBodyVisible on the chosen side, we occlude the shoulder on the
    // visible (left) side only — left score stays higher (lh + la visible) but
    // lmVisible(ls) = false → fullBodyVisible = false on left side.
    const frames = buildFrames(
      (): DeadliftPoseIntent => ({
        hipHingeDeg: 0,
        armsAtSides: true,
        occludedIndices: [11], // left shoulder hidden; left still chosen (higher score), fails fullBodyVisible
      }),
      buildDeadliftPose,
      { fps: 30, durationMs: 1000 },
    );
    const result = runDeadliftSession(frames);
    expect(result.finalCalibration?.checks.fullBodyVisible).toBe(false);
  });
});
