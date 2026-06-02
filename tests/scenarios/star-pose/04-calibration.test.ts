import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildStarPosePose } from '../../harness/pose-stub';
import { runStarPoseSession } from '../../harness/runner';
import { IDX } from '../../harness/types';

describe('Star Pose — calibration gates', () => {
  it('confirms within 2.2s when all gates pass', () => {
    const frames = buildFrames(
      () => ({ liftedSide: 'left' as const }),
      buildStarPosePose,
      { fps: 30, durationMs: 3000 },
    );
    const result = runStarPoseSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThanOrEqual(2300);
  });

  it('fails the legExtended gate when the leg is lifted but NOT spread wide', () => {
    // legSpread 0.05 → ankleXSep ≈ 0.09; 0.09/0.16 ≈ 0.56 < LEG_LATERAL_RATIO (1.30).
    const frames = buildFrames(
      () => ({ liftedSide: 'left' as const, legSpread: 0.05 }),
      buildStarPosePose,
      { fps: 30, durationMs: 3000 },
    );
    const result = runStarPoseSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.checks.feetWide).toBe(false);
  });

  it('fails the legExtended gate when both feet are on the floor (no lift)', () => {
    // liftElevation 0.01 → ankleYDiff/0.16 ≈ 0.06 < LEG_LIFT_RATIO (0.12).
    const frames = buildFrames(
      () => ({ liftedSide: 'left' as const, liftElevation: 0.01 }),
      buildStarPosePose,
      { fps: 30, durationMs: 3000 },
    );
    const result = runStarPoseSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.checks.feetWide).toBe(false);
  });

  it('fails the armsUp gate when the arms are down at the sides', () => {
    const frames = buildFrames(
      () => ({ liftedSide: 'left' as const, armsUp: false }),
      buildStarPosePose,
      { fps: 30, durationMs: 3000 },
    );
    const result = runStarPoseSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.checks.armsOverhead).toBe(false);
  });

  it('REJECTS confirmation when shoulderWidth is too narrow (too-far, Fix X)', () => {
    const frames = buildFrames(
      () => ({ liftedSide: 'left' as const, shoulderWidthOverride: 0.05 }),
      buildStarPosePose,
      { fps: 30, durationMs: 3000 },
    );
    const result = runStarPoseSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.checks.distanceOk).toBe(false);
    expect(result.finalCalibration?.distanceHint).toBe('too-far');
  });

  it('fails when key landmarks are occluded (fullBodyVisible gate)', () => {
    const frames = buildFrames(
      () => ({ liftedSide: 'left' as const, occludedIndices: [IDX.leftAnkle] }),
      buildStarPosePose,
      { fps: 30, durationMs: 3000 },
    );
    const result = runStarPoseSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.checks.fullBodyVisible).toBe(false);
  });
});
