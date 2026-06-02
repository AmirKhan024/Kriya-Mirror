/**
 * Calibration tests:
 *   - 4 gates pass on a clean inverted V (Fix G instant confirm ~200ms)
 *   - distanceHint='too-far' when the leg drop is below the floor (Fix X analog)
 *   - distanceHint='too-close' when the leg drop overflows the band
 *   - Shallow V fails the "sharp V" gate (armsOverhead remap)
 *   - Occluded wrist fails the fullBodyVisible gate
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildDownwardDogPose } from '../../harness/pose-stub';
import { runDownwardDogSession } from '../../harness/runner';
import { IDX } from '../../harness/types';
import type { DownwardDogPoseIntent } from '../../harness/types';

describe('Downward Dog — calibration', () => {
  it('confirms within ~400ms once all gates are green (Fix G instant calibration)', () => {
    const frames = buildFrames(
      (): DownwardDogPoseIntent => ({ apexAngleDeg: 90, side: 'left' }),
      buildDownwardDogPose,
      { fps: 30, durationMs: 1500 },
    );
    const result = runDownwardDogSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThanOrEqual(400);
  });

  it('reports too-far when the leg drop is below the floor (Fix X analog)', () => {
    const frames = buildFrames(
      (): DownwardDogPoseIntent => ({ apexAngleDeg: 90, bodyHeight: 0.12, side: 'left' }),
      buildDownwardDogPose,
      { fps: 30, durationMs: 1500 },
    );
    const result = runDownwardDogSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.distanceHint).toBe('too-far');
    expect(result.finalCalibration?.checks.distanceOk).toBe(false);
  });

  it('reports too-close when the leg drop overflows the band', () => {
    const frames = buildFrames(
      (): DownwardDogPoseIntent => ({ apexAngleDeg: 90, bodyHeight: 0.62, side: 'left' }),
      buildDownwardDogPose,
      { fps: 30, durationMs: 1500 },
    );
    const result = runDownwardDogSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.distanceHint).toBe('too-close');
  });

  it('keeps the "sharp V" gate red when the inverted V is too shallow', () => {
    const frames = buildFrames(
      (): DownwardDogPoseIntent => ({ apexAngleDeg: 130, side: 'left' }),
      buildDownwardDogPose,
      { fps: 30, durationMs: 1500 },
    );
    const result = runDownwardDogSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.checks.armsOverhead).toBe(false); // remap: sharp V
  });

  it('keeps fullBodyVisible red when the camera-side wrist is occluded', () => {
    const frames = buildFrames(
      (): DownwardDogPoseIntent => ({ apexAngleDeg: 90, side: 'left', occludedIndices: [IDX.leftWrist] }),
      buildDownwardDogPose,
      { fps: 30, durationMs: 1500 },
    );
    const result = runDownwardDogSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.checks.fullBodyVisible).toBe(false);
  });
});
