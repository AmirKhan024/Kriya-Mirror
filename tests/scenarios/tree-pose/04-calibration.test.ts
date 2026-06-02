/**
 * Calibration tests:
 *   - 4 gates pass on a clean tree pose (Fix G instant confirm)
 *   - Foot lifted but NOT on standing leg → fails feetWide gate
 *   - Foot on standing leg but arms at sides → fails armsOverhead (armsReady) gate
 *   - Narrow shoulderWidth (Fix X) → reject as too-far
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildTreePosePose } from '../../harness/pose-stub';
import { runTreePoseSession } from '../../harness/runner';
import type { TreePosePoseIntent } from '../../harness/types';

describe('Tree Pose — calibration', () => {
  it('confirms within ~400ms when all gates pass (Fix G instant)', () => {
    const frames = buildFrames(
      () => ({ liftedSide: 'left' as const, wrists: 'chest' as const } as TreePosePoseIntent),
      buildTreePosePose,
      { fps: 30, durationMs: 1500 },
    );
    const result = runTreePoseSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThanOrEqual(400);
  });

  it('fails feetWide when foot is lifted but NOT on the standing leg', () => {
    // Foot lifted (passes lift gate) but offset 0.15 from standing knee
    // (clearly off the leg → foot-on-leg sub-check fails).
    const frames = buildFrames(
      () => ({ liftedSide: 'left' as const, liftedAnkleXOffset: 0.15 } as TreePosePoseIntent),
      buildTreePosePose,
      { fps: 30, durationMs: 1500 },
    );
    const result = runTreePoseSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.checks.feetWide).toBe(false);
  });

  it('fails armsOverhead (armsReady) gate when arms are at sides', () => {
    const frames = buildFrames(
      () => ({ liftedSide: 'left' as const, wrists: 'sides' as const } as TreePosePoseIntent),
      buildTreePosePose,
      { fps: 30, durationMs: 1500 },
    );
    const result = runTreePoseSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.checks.armsOverhead).toBe(false);
  });

  it('rejects narrow-shoulderWidth baseline as too-far (Fix X)', () => {
    const frames = buildFrames(
      () => ({ liftedSide: 'left' as const, shoulderWidthOverride: 0.05 } as TreePosePoseIntent),
      buildTreePosePose,
      { fps: 30, durationMs: 1500 },
    );
    const result = runTreePoseSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.distanceHint).toBe('too-far');
    expect(result.finalCalibration?.checks.distanceOk).toBe(false);
  });
});
