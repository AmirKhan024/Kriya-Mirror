import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildLateralRaisePose } from '../../harness/pose-stub';
import { runLateralRaiseSession } from '../../harness/runner';
import { IDX } from '../../harness/types';

describe('Lateral Raise — calibration gates', () => {
  it('confirms within 2.3s when all gates pass (Fix G instant cal)', () => {
    const frames = buildFrames(
      () => ({ abductionDeg: 0 }),
      buildLateralRaisePose,
      { fps: 30, durationMs: 3000 },
    );
    const result = runLateralRaiseSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThanOrEqual(2300);
  });

  it('fails the armsAtSides gate when arms are mid-raise (abduction too high)', () => {
    const frames = buildFrames(
      () => ({ abductionDeg: 60 }),    // > 25° threshold → fails armsAtSides
      buildLateralRaisePose,
      { fps: 30, durationMs: 3000 },
    );
    const result = runLateralRaiseSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.checks.armsOverhead).toBe(false);
  });

  it('fails the feetStable gate when feet are wider than 1.20× shoulders', () => {
    const frames = buildFrames(
      () => ({ abductionDeg: 0, feetWidthRatio: 1.40 }),
      buildLateralRaisePose,
      { fps: 30, durationMs: 3000 },
    );
    const result = runLateralRaiseSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.checks.feetWide).toBe(false);
  });

  it('fails when key landmarks are occluded (fullBodyVisible gate)', () => {
    const frames = buildFrames(
      () => ({ abductionDeg: 0, occludedIndices: [IDX.leftElbow] }),
      buildLateralRaisePose,
      { fps: 30, durationMs: 3000 },
    );
    const result = runLateralRaiseSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.checks.fullBodyVisible).toBe(false);
  });

  it('rejects narrow-shoulderWidth baselines as too-far (Fix X)', () => {
    // shoulderWidth = 0.05 is below the MIN_SHOULDER_WIDTH = 0.08 floor.
    // Calibration must refuse to confirm and surface 'too-far' so the user
    // steps closer.
    const frames = buildFrames(
      () => ({ abductionDeg: 0, shoulderWidthOverride: 0.05 }),
      buildLateralRaisePose,
      { fps: 30, durationMs: 3000 },
    );
    const result = runLateralRaiseSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.distanceHint).toBe('too-far');
    expect(result.finalCalibration?.checks.distanceOk).toBe(false);
  });
});
