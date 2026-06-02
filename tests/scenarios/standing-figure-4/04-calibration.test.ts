/**
 * Calibration gates:
 *   - 4 gates pass on a clean figure-4 (Fix G instant confirm)
 *   - Foot lifted but NOT crossed onto the standing knee → fails feetWide
 *   - Arms at sides → fails armsOverhead (armsReady) gate
 *   - Narrow shoulderWidth (Fix X) → reject as too-far
 *   - Occluded landmark → fails fullBodyVisible
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildStandingFigure4Pose } from '../../harness/pose-stub';
import { runStandingFigure4Session } from '../../harness/runner';
import { IDX } from '../../harness/types';
import type { StandingFigure4PoseIntent } from '../../harness/types';

describe('Standing Figure-4 — calibration', () => {
  it('confirms within ~400ms when all gates pass (Fix G instant)', () => {
    const frames = buildFrames(
      () => ({ liftedSide: 'left' as const, wrists: 'chest' as const } as StandingFigure4PoseIntent),
      buildStandingFigure4Pose,
      { fps: 30, durationMs: 1500 },
    );
    const result = runStandingFigure4Session(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThanOrEqual(400);
  });

  it('fails feetWide when foot is lifted but NOT crossed onto the standing knee', () => {
    const frames = buildFrames(
      () => ({ liftedSide: 'left' as const, liftedAnkleXOffset: 0.15 } as StandingFigure4PoseIntent),
      buildStandingFigure4Pose,
      { fps: 30, durationMs: 1500 },
    );
    const result = runStandingFigure4Session(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.checks.feetWide).toBe(false);
  });

  it('fails feetWide when both feet are on the floor (no lift)', () => {
    const frames = buildFrames(
      () => ({ liftedSide: 'left' as const, liftElevation: 0.01 } as StandingFigure4PoseIntent),
      buildStandingFigure4Pose,
      { fps: 30, durationMs: 1500 },
    );
    const result = runStandingFigure4Session(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.checks.feetWide).toBe(false);
  });

  it('fails armsOverhead (armsReady) gate when arms are at sides', () => {
    const frames = buildFrames(
      () => ({ liftedSide: 'left' as const, wrists: 'sides' as const } as StandingFigure4PoseIntent),
      buildStandingFigure4Pose,
      { fps: 30, durationMs: 1500 },
    );
    const result = runStandingFigure4Session(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.checks.armsOverhead).toBe(false);
  });

  it('rejects narrow-shoulderWidth baseline as too-far (Fix X)', () => {
    const frames = buildFrames(
      () => ({ liftedSide: 'left' as const, shoulderWidthOverride: 0.05 } as StandingFigure4PoseIntent),
      buildStandingFigure4Pose,
      { fps: 30, durationMs: 1500 },
    );
    const result = runStandingFigure4Session(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.distanceHint).toBe('too-far');
    expect(result.finalCalibration?.checks.distanceOk).toBe(false);
  });

  it('fails when key landmarks are occluded (fullBodyVisible gate)', () => {
    const frames = buildFrames(
      () => ({ liftedSide: 'left' as const, occludedIndices: [IDX.rightAnkle] } as StandingFigure4PoseIntent),
      buildStandingFigure4Pose,
      { fps: 30, durationMs: 1500 },
    );
    const result = runStandingFigure4Session(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.checks.fullBodyVisible).toBe(false);
  });
});
