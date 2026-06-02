import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildLungePose } from '../../harness/pose-stub';
import { runLungeSession } from '../../harness/runner';
import { IDX } from '../../harness/types';

describe('Lunge — calibration gates', () => {
  it('confirms within 2.2s when all gates pass', () => {
    const frames = buildFrames(
      () => ({ kneeFlexionDeg: 0, frontLeg: 'left' as const, armsAtSides: true, feetWidthRatio: 1.0 }),
      buildLungePose,
      { fps: 30, durationMs: 3000 },
    );
    const result = runLungeSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThanOrEqual(2300);
  });

  it('fails when arms are overhead (armsAtSides gate)', () => {
    // Wrists above shoulders fails the "arms at sides" check that lunge needs.
    const frames = buildFrames(
      () => ({ kneeFlexionDeg: 0, frontLeg: 'left' as const, armsAtSides: false, feetWidthRatio: 1.0 }),
      buildLungePose,
      { fps: 30, durationMs: 3000 },
    );
    const result = runLungeSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.checks.armsOverhead).toBe(false);
  });

  it('fails when feet are too wide (feetTogether gate)', () => {
    // Feet at 1.5× shoulder width fails the lunge feet-together check.
    const frames = buildFrames(
      () => ({ kneeFlexionDeg: 0, frontLeg: 'left' as const, armsAtSides: true, feetWidthRatio: 1.5 }),
      buildLungePose,
      { fps: 30, durationMs: 3000 },
    );
    const result = runLungeSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.checks.feetWide).toBe(false);
  });

  it('fails when key landmarks are occluded (fullBodyVisible gate)', () => {
    const frames = buildFrames(
      () => ({
        kneeFlexionDeg: 0, frontLeg: 'left' as const, armsAtSides: true, feetWidthRatio: 1.0,
        occludedIndices: [IDX.leftAnkle],
      }),
      buildLungePose,
      { fps: 30, durationMs: 3000 },
    );
    const result = runLungeSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.checks.fullBodyVisible).toBe(false);
  });
});
