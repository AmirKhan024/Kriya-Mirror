import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildSquatPose } from '../../harness/pose-stub';
import { runSquatSession } from '../../harness/runner';
import { IDX } from '../../harness/types';

describe('Squat — calibration gates', () => {
  it('confirms within 2.2s when all gates pass', () => {
    const frames = buildFrames(
      () => ({ kneeFlexionDeg: 0, feetWidthRatio: 1.25, armsOverhead: true }),
      buildSquatPose,
      { fps: 30, durationMs: 3000 },
    );
    const result = runSquatSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThanOrEqual(2300);
  });

  it('fails when arms are at sides (armsOverhead gate)', () => {
    const frames = buildFrames(
      () => ({ kneeFlexionDeg: 0, feetWidthRatio: 1.25, armsOverhead: false }),
      buildSquatPose,
      { fps: 30, durationMs: 3000 },
    );
    const result = runSquatSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.checks.armsOverhead).toBe(false);
  });

  it('fails when feet are too narrow (feetWide gate)', () => {
    const frames = buildFrames(
      () => ({ kneeFlexionDeg: 0, feetWidthRatio: 0.9, armsOverhead: true }), // narrower than shoulders
      buildSquatPose,
      { fps: 30, durationMs: 3000 },
    );
    const result = runSquatSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.checks.feetWide).toBe(false);
  });

  it('fails when key landmarks are occluded (fullBodyVisible gate)', () => {
    // Hide one ankle entirely
    const frames = buildFrames(
      () => ({
        kneeFlexionDeg: 0, feetWidthRatio: 1.25, armsOverhead: true,
        occludedIndices: [IDX.leftAnkle],
      }),
      buildSquatPose,
      { fps: 30, durationMs: 3000 },
    );
    const result = runSquatSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.checks.fullBodyVisible).toBe(false);
  });
});
