import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildFrontRaisePose } from '../../harness/pose-stub';
import { runFrontRaiseSession } from '../../harness/runner';
import { IDX } from '../../harness/types';

describe('Front Raise — calibration gates', () => {
  it('confirms within 2.2s when all gates pass (front camera, arms at sides)', () => {
    const frames = buildFrames(
      () => ({ shoulderFlexionDeg: 0 }),
      buildFrontRaisePose,
      { fps: 30, durationMs: 3000 },
    );
    const result = runFrontRaiseSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThanOrEqual(2300);
  });

  it('fails the armsAtSides gate when arms are mid-raise (flex too high)', () => {
    const frames = buildFrames(
      () => ({ shoulderFlexionDeg: 60 }),     // measured ~30° > 25° → fails armsAtSides
      buildFrontRaisePose,
      { fps: 30, durationMs: 3000 },
    );
    const result = runFrontRaiseSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.checks.armsOverhead).toBe(false);
  });

  it('fails when key landmarks are occluded (fullBodyVisible gate)', () => {
    const frames = buildFrames(
      () => ({ shoulderFlexionDeg: 0, occludedIndices: [IDX.leftWrist, IDX.rightWrist] }),
      buildFrontRaisePose,
      { fps: 30, durationMs: 3000 },
    );
    const result = runFrontRaiseSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.checks.fullBodyVisible).toBe(false);
  });

  // Fix X cal side — shoulderWidth floor (round 21: front camera uses
  // shoulderWidth, not bodyHeight, as the distance reference).
  it('rejects calibration with degenerate shoulderWidth (Fix X cal side, round 21)', () => {
    const frames = buildFrames(
      () => ({ shoulderFlexionDeg: 0, shoulderWidthOverride: 0.05 }),  // < MIN_SHOULDER_WIDTH=0.08
      buildFrontRaisePose,
      { fps: 30, durationMs: 3000 },
    );
    const result = runFrontRaiseSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.checks.distanceOk).toBe(false);
    expect(result.finalCalibration?.distanceHint).toBe('too-far');
  });

  it('fails the feetStable gate when feet are wider than 1.20× shoulder width', () => {
    const frames = buildFrames(
      () => ({ shoulderFlexionDeg: 0, feetWidthRatio: 1.6 }),
      buildFrontRaisePose,
      { fps: 30, durationMs: 3000 },
    );
    const result = runFrontRaiseSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.checks.feetWide).toBe(false);
  });
});
