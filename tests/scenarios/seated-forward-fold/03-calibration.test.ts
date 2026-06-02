/**
 * Calibration tests:
 *   - 4 gates pass on a clean seated fold (Fix G instant confirm ~200ms)
 *   - distanceHint='too-far' when the leg span is below the floor (Fix X analog)
 *   - distanceHint='too-close' when the leg span overflows the band
 *   - Shallow fold fails the "folded" gate (armsOverhead remap)
 *   - A STANDING pose fails the "legs extended on the floor" gate (feetWide remap)
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildSeatedForwardFoldPose, buildForwardFoldPose } from '../../harness/pose-stub';
import { runSeatedForwardFoldSession } from '../../harness/runner';
import type { SeatedForwardFoldPoseIntent, ForwardFoldPoseIntent } from '../../harness/types';

describe('Seated Forward Fold — calibration', () => {
  it('confirms within ~400ms once all gates are green (Fix G instant calibration)', () => {
    const frames = buildFrames(
      (): SeatedForwardFoldPoseIntent => ({ foldAngleDeg: 65, side: 'left' }),
      buildSeatedForwardFoldPose,
      { fps: 30, durationMs: 1500 },
    );
    const result = runSeatedForwardFoldSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThanOrEqual(400);
  });

  it('reports too-far when the leg span is below the floor (Fix X analog)', () => {
    const frames = buildFrames(
      (): SeatedForwardFoldPoseIntent => ({ foldAngleDeg: 65, bodyLengthX: 0.10, side: 'left' }),
      buildSeatedForwardFoldPose,
      { fps: 30, durationMs: 1500 },
    );
    const result = runSeatedForwardFoldSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.distanceHint).toBe('too-far');
    expect(result.finalCalibration?.checks.distanceOk).toBe(false);
  });

  it('reports too-close when the leg span overflows the band', () => {
    const frames = buildFrames(
      (): SeatedForwardFoldPoseIntent => ({ foldAngleDeg: 65, bodyLengthX: 1.2, side: 'left' }),
      buildSeatedForwardFoldPose,
      { fps: 30, durationMs: 1500 },
    );
    const result = runSeatedForwardFoldSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.distanceHint).toBe('too-close');
  });

  it('keeps the "folded" gate red when the torso is barely folded', () => {
    const frames = buildFrames(
      (): SeatedForwardFoldPoseIntent => ({ foldAngleDeg: 10, side: 'left' }),
      buildSeatedForwardFoldPose,
      { fps: 30, durationMs: 1500 },
    );
    const result = runSeatedForwardFoldSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.checks.armsOverhead).toBe(false); // remap: folded
  });

  it('rejects a STANDING pose via the "legs extended" gate (legs vertical, not on the floor)', () => {
    // A standing forward-fold silhouette: legs are vertical, so the "legs
    // extended on the floor" gate must reject it.
    const frames = buildFrames(
      (): ForwardFoldPoseIntent => ({ foldAngleDeg: 10, kneeFlexionDeg: 5, side: 'left' }),
      buildForwardFoldPose,
      { fps: 30, durationMs: 1500 },
    );
    const result = runSeatedForwardFoldSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.checks.feetWide).toBe(false); // remap: legs extended
  });
});
