/**
 * Calibration tests:
 *   - 4 gates pass on a clean straight side plank (Fix G instant confirm ~200 ms)
 *   - Hips sagging at start → fails the straight-ready gate
 *   - A key landmark occluded → fails fullBodyVisible
 *   - Body length below the floor (too far) → Fix X analog: too-far hint
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildSidePlankPose } from '../../harness/pose-stub';
import { runSidePlankSession } from '../../harness/runner';
import { IDX } from '../../harness/types';
import type { SidePlankPoseIntent } from '../../harness/types';

describe('Side Plank — calibration', () => {
  it('confirms within ~400 ms when all gates pass (Fix G instant)', () => {
    const frames = buildFrames(
      () => ({ hipDelta: 0 } as SidePlankPoseIntent),
      buildSidePlankPose,
      { fps: 30, durationMs: 1500 },
    );
    const result = runSidePlankSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThanOrEqual(400);
  });

  it('fails the straight-ready gate when the hips sag at start', () => {
    const frames = buildFrames(
      () => ({ hipDelta: 0.08 } as SidePlankPoseIntent),
      buildSidePlankPose,
      { fps: 30, durationMs: 1500 },
    );
    const result = runSidePlankSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.checks.armsOverhead).toBe(false);
  });

  it('fails when a key landmark is occluded (fullBodyVisible gate)', () => {
    const frames = buildFrames(
      () => ({ hipDelta: 0, occludedIndices: [IDX.leftAnkle] } as SidePlankPoseIntent),
      buildSidePlankPose,
      { fps: 30, durationMs: 1500 },
    );
    const result = runSidePlankSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.checks.fullBodyVisible).toBe(false);
  });

  it('reports too-far when body length is below the floor (Fix X analog)', () => {
    const frames = buildFrames(
      () => ({ hipDelta: 0, bodyLengthX: 0.20 } as SidePlankPoseIntent),
      buildSidePlankPose,
      { fps: 30, durationMs: 1500 },
    );
    const result = runSidePlankSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.distanceHint).toBe('too-far');
    expect(result.finalCalibration?.checks.distanceOk).toBe(false);
  });
});
