/**
 * Calibration tests:
 *   - 4 gates pass on a clean V (Fix G instant confirm ~200 ms)
 *   - Legs not lifted → fails the legs-up gate
 *   - Chest not lifted → fails the chest-up gate
 *   - A key landmark occluded → fails fullBodyVisible
 *   - Torso length below the floor (too far) → Fix X analog: too-far hint
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildBoatPosePose } from '../../harness/pose-stub';
import { runBoatPoseSession } from '../../harness/runner';
import { IDX } from '../../harness/types';
import type { BoatPosePoseIntent } from '../../harness/types';

describe('Boat Pose — calibration', () => {
  it('confirms within ~400 ms when all gates pass (Fix G instant)', () => {
    const frames = buildFrames(
      () => ({ torsoAngleDeg: 45, legAngleDeg: 40 } as BoatPosePoseIntent),
      buildBoatPosePose,
      { fps: 30, durationMs: 1500 },
    );
    const result = runBoatPoseSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThanOrEqual(400);
  });

  it('fails the legs-up gate when the legs are not lifted', () => {
    const frames = buildFrames(
      () => ({ torsoAngleDeg: 45, legAngleDeg: 10 } as BoatPosePoseIntent),
      buildBoatPosePose,
      { fps: 30, durationMs: 1500 },
    );
    const result = runBoatPoseSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.checks.feetWide).toBe(false);
  });

  it('fails the chest-up gate when the chest is not lifted', () => {
    const frames = buildFrames(
      () => ({ torsoAngleDeg: 15, legAngleDeg: 40 } as BoatPosePoseIntent),
      buildBoatPosePose,
      { fps: 30, durationMs: 1500 },
    );
    const result = runBoatPoseSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.checks.armsOverhead).toBe(false);
  });

  it('fails when a key landmark is occluded (fullBodyVisible gate)', () => {
    const frames = buildFrames(
      () => ({ torsoAngleDeg: 45, legAngleDeg: 40, occludedIndices: [IDX.leftAnkle] } as BoatPosePoseIntent),
      buildBoatPosePose,
      { fps: 30, durationMs: 1500 },
    );
    const result = runBoatPoseSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.checks.fullBodyVisible).toBe(false);
  });

  it('reports too-far when torso length is below the floor (Fix X analog)', () => {
    const frames = buildFrames(
      () => ({ torsoAngleDeg: 45, legAngleDeg: 40, torsoLen: 0.06 } as BoatPosePoseIntent),
      buildBoatPosePose,
      { fps: 30, durationMs: 1500 },
    );
    const result = runBoatPoseSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.distanceHint).toBe('too-far');
    expect(result.finalCalibration?.checks.distanceOk).toBe(false);
  });
});
