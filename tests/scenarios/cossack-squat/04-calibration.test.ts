import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildCossackSquatPose } from '../../harness/pose-stub';
import { runCossackSquatSession } from '../../harness/runner';
import { IDX } from '../../harness/types';
import type { CossackSquatPoseIntent } from '../../harness/types';

describe('Cossack Squat — calibration gates', () => {
  it('confirms within 2.2s when standing in a wide stance, arms at sides', () => {
    const frames = buildFrames(
      () => ({ workingKneeFlexionDeg: 0, workingSide: 'left' as const, armsAtSides: true, feetWidthRatio: 1.8 } as CossackSquatPoseIntent),
      buildCossackSquatPose,
      { fps: 30, durationMs: 3000 },
    );
    const result = runCossackSquatSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThanOrEqual(2300);
  });

  it('fails the wide-stance gate when feet are only hip-width', () => {
    // feetWidthRatio 1.0 → ankle/shoulder ratio 1.0 < MIN_WIDE_RATIO (1.3).
    const frames = buildFrames(
      () => ({ workingKneeFlexionDeg: 0, workingSide: 'left' as const, armsAtSides: true, feetWidthRatio: 1.0 } as CossackSquatPoseIntent),
      buildCossackSquatPose,
      { fps: 30, durationMs: 3000 },
    );
    const result = runCossackSquatSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.checks.feetWide).toBe(false);
  });

  it('fails the armsAtSides gate when arms are overhead', () => {
    const frames = buildFrames(
      () => ({ workingKneeFlexionDeg: 0, workingSide: 'left' as const, armsAtSides: false, feetWidthRatio: 1.8 } as CossackSquatPoseIntent),
      buildCossackSquatPose,
      { fps: 30, durationMs: 3000 },
    );
    const result = runCossackSquatSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.checks.armsOverhead).toBe(false);
  });

  it('fails when key landmarks are occluded (fullBodyVisible gate)', () => {
    const frames = buildFrames(
      () => ({
        workingKneeFlexionDeg: 0, workingSide: 'left' as const, armsAtSides: true, feetWidthRatio: 1.8,
        occludedIndices: [IDX.leftAnkle],
      } as CossackSquatPoseIntent),
      buildCossackSquatPose,
      { fps: 30, durationMs: 3000 },
    );
    const result = runCossackSquatSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.checks.fullBodyVisible).toBe(false);
  });
});
