import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildSingleLegStandPose } from '../../harness/pose-stub';
import { runSingleLegStandSession } from '../../harness/runner';
import { IDX } from '../../harness/types';

describe('Single Leg Stand — calibration gates', () => {
  it('confirms within 2.2s when all gates pass', () => {
    const frames = buildFrames(
      () => ({ liftedSide: 'left' as const }),
      buildSingleLegStandPose,
      { fps: 30, durationMs: 3000 },
    );
    const result = runSingleLegStandSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThanOrEqual(2300);
  });

  it('fails the oneFootLifted gate when both feet are on the floor', () => {
    // liftElevation = 0.01 — well below 0.40 × shoulderWidth (0.16) = 0.064 threshold
    const frames = buildFrames(
      () => ({ liftedSide: 'left' as const, liftElevation: 0.01 }),
      buildSingleLegStandPose,
      { fps: 30, durationMs: 3000 },
    );
    const result = runSingleLegStandSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.checks.feetWide).toBe(false);
  });

  it('fails the armsRelaxed gate when arms are raised', () => {
    const frames = buildFrames(
      () => ({ liftedSide: 'left' as const, armsRaised: true }),
      buildSingleLegStandPose,
      { fps: 30, durationMs: 3000 },
    );
    const result = runSingleLegStandSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.checks.armsOverhead).toBe(false);
  });

  it('round 14: REJECTS confirmation when ankle is lifted but knee is NOT bent (false-positive case)', () => {
    // Simulates the physical-test false positive: MediaPipe reports an
    // ankle Y diff (weight shift, noise, etc.) but the knee is not actually
    // bent. The user is NOT lifting their leg, but the old ankle-only gate
    // would falsely pass. The new knee-AND-ankle gate must reject.
    const frames = buildFrames(
      () => ({
        liftedSide: 'left' as const,
        liftElevation: 0.10,        // ankle clearly lifted → ankle gate passes
        kneeLiftOverride: 0,        // knee NOT lifted → knee gate FAILS
      }),
      buildSingleLegStandPose,
      { fps: 30, durationMs: 3000 },
    );
    const result = runSingleLegStandSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.checks.feetWide).toBe(false);
  });

  it('round 13: REJECTS confirmation when shoulderWidth is too narrow (too-far)', () => {
    // shoulderWidth = 0.05 (below MIN_SHOULDER_WIDTH=0.08) → distance gate
    // fails with distanceHint='too-far'. Prevents locking in a degenerate
    // baseline where all distance-normalized thresholds collapse.
    const frames = buildFrames(
      () => ({ liftedSide: 'left' as const, shoulderWidthOverride: 0.05 }),
      buildSingleLegStandPose,
      { fps: 30, durationMs: 3000 },
    );
    const result = runSingleLegStandSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.checks.distanceOk).toBe(false);
    expect(result.finalCalibration?.distanceHint).toBe('too-far');
  });

  it('fails when key landmarks are occluded (fullBodyVisible gate)', () => {
    const frames = buildFrames(
      () => ({ liftedSide: 'left' as const, occludedIndices: [IDX.leftAnkle] }),
      buildSingleLegStandPose,
      { fps: 30, durationMs: 3000 },
    );
    const result = runSingleLegStandSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.checks.fullBodyVisible).toBe(false);
  });
});
