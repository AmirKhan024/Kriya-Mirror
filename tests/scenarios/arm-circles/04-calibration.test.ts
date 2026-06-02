import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildArmCirclesPose } from '../../harness/pose-stub';
import { runArmCirclesSession } from '../../harness/runner';
import { IDX } from '../../harness/types';

describe('Arm Circles — calibration gates', () => {
  it('confirms within 2.2s when all gates pass (front camera, arms at sides)', () => {
    const frames = buildFrames(
      () => ({ abductionDeg: 0 }),
      buildArmCirclesPose,
      { fps: 30, durationMs: 3000 },
    );
    const result = runArmCirclesSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThanOrEqual(2300);
  });

  it('fails the armsAtSides gate when arms are already mid-raise', () => {
    const frames = buildFrames(
      () => ({ abductionDeg: 60 }),     // > 25° abduction → fails
      buildArmCirclesPose,
      { fps: 30, durationMs: 3000 },
    );
    const result = runArmCirclesSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.checks.armsOverhead).toBe(false);
  });

  it('fails when key landmarks are occluded (fullBodyVisible gate)', () => {
    const frames = buildFrames(
      () => ({ abductionDeg: 0, occludedIndices: [IDX.leftWrist, IDX.rightWrist] }),
      buildArmCirclesPose,
      { fps: 30, durationMs: 3000 },
    );
    const result = runArmCirclesSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.checks.fullBodyVisible).toBe(false);
  });

  // Fix X cal side — front-camera uses shoulderWidth floor.
  it('rejects calibration with degenerate shoulderWidth (Fix X, round 21)', () => {
    const frames = buildFrames(
      () => ({ abductionDeg: 0, shoulderWidthOverride: 0.05 }),  // < MIN_SHOULDER_WIDTH=0.08
      buildArmCirclesPose,
      { fps: 30, durationMs: 3000 },
    );
    const result = runArmCirclesSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.checks.distanceOk).toBe(false);
    expect(result.finalCalibration?.distanceHint).toBe('too-far');
  });

  it('fails the feetStable gate when feet are wider than 1.20× shoulder width', () => {
    const frames = buildFrames(
      () => ({ abductionDeg: 0, feetWidthRatio: 1.6 }),
      buildArmCirclesPose,
      { fps: 30, durationMs: 3000 },
    );
    const result = runArmCirclesSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.checks.feetWide).toBe(false);
  });
});
