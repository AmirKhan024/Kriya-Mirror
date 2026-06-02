import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildJumpingJacksPose } from '../../harness/pose-stub';
import { runJumpingJacksSession } from '../../harness/runner';
import { IDX } from '../../harness/types';

describe('Jumping Jacks — calibration gates', () => {
  it('confirms within 2.2s when all gates pass (CLOSED stance)', () => {
    const frames = buildFrames(
      () => ({ armOpennessPct: 0, legOpennessPct: 30 }),
      buildJumpingJacksPose,
      { fps: 30, durationMs: 3000 },
    );
    const result = runJumpingJacksSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThanOrEqual(2300);
  });

  it('fails the armsAtSides gate when arms are already raised (mid-jack)', () => {
    const frames = buildFrames(
      () => ({ armOpennessPct: 80, legOpennessPct: 30 }),
      buildJumpingJacksPose,
      { fps: 30, durationMs: 3000 },
    );
    const result = runJumpingJacksSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.checks.armsOverhead).toBe(false);
  });

  it('fails the feetClose gate when feet are wide apart (mid-jack)', () => {
    const frames = buildFrames(
      () => ({ armOpennessPct: 0, legOpennessPct: 100 }),
      buildJumpingJacksPose,
      { fps: 30, durationMs: 3000 },
    );
    const result = runJumpingJacksSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.checks.feetWide).toBe(false);
  });

  it('fails when key landmarks are occluded (fullBodyVisible gate)', () => {
    const frames = buildFrames(
      () => ({ armOpennessPct: 0, legOpennessPct: 30, occludedIndices: [IDX.leftWrist] }),
      buildJumpingJacksPose,
      { fps: 30, durationMs: 3000 },
    );
    const result = runJumpingJacksSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.checks.fullBodyVisible).toBe(false);
  });

  // Fix X cal side — narrow shoulder width rejection.
  it('rejects calibration with degenerate shoulderWidth (Fix X cal side)', () => {
    const frames = buildFrames(
      () => ({ armOpennessPct: 0, legOpennessPct: 30, shoulderWidthOverride: 0.05 }),
      buildJumpingJacksPose,
      { fps: 30, durationMs: 3000 },
    );
    const result = runJumpingJacksSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.checks.distanceOk).toBe(false);
    expect(result.finalCalibration?.distanceHint).toBe('too-far');
  });
});
