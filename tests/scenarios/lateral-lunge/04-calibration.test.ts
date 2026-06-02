import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildLateralLungePose } from '../../harness/pose-stub';
import { runLateralLungeSession } from '../../harness/runner';
import { IDX } from '../../harness/types';

describe('Lateral Lunge — calibration gates', () => {
  it('confirms within 2.2s when all gates pass', () => {
    const frames = buildFrames(
      () => ({ workingKneeFlexionDeg: 0, workingSide: 'left' as const, armsAtSides: true, feetWidthRatio: 1.0 }),
      buildLateralLungePose,
      { fps: 30, durationMs: 3000 },
    );
    const result = runLateralLungeSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThanOrEqual(2300);
  });

  it('fails when arms are overhead (armsAtSides gate)', () => {
    const frames = buildFrames(
      () => ({ workingKneeFlexionDeg: 0, workingSide: 'left' as const, armsAtSides: false, feetWidthRatio: 1.0 }),
      buildLateralLungePose,
      { fps: 30, durationMs: 3000 },
    );
    const result = runLateralLungeSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.checks.armsOverhead).toBe(false);
  });

  it('fails when feet start too wide (feetTogether gate)', () => {
    // Lateral lunge starts feet hip-width — beginning already wide fails the gate.
    const frames = buildFrames(
      () => ({ workingKneeFlexionDeg: 0, workingSide: 'left' as const, armsAtSides: true, feetWidthRatio: 1.5 }),
      buildLateralLungePose,
      { fps: 30, durationMs: 3000 },
    );
    const result = runLateralLungeSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.checks.feetWide).toBe(false);
  });

  it('fails when key landmarks are occluded (fullBodyVisible gate)', () => {
    const frames = buildFrames(
      () => ({
        workingKneeFlexionDeg: 0, workingSide: 'left' as const, armsAtSides: true, feetWidthRatio: 1.0,
        occludedIndices: [IDX.leftAnkle],
      }),
      buildLateralLungePose,
      { fps: 30, durationMs: 3000 },
    );
    const result = runLateralLungeSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.checks.fullBodyVisible).toBe(false);
  });
});
