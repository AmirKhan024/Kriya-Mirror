import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildShrugPose } from '../../harness/pose-stub';
import { runShrugSession } from '../../harness/runner';
import { IDX } from '../../harness/types';

describe('Shrug — calibration gates', () => {
  it('confirms within 300ms (≤2.2s total) when all gates pass', () => {
    const frames = buildFrames(
      () => ({ shoulderElevation: 0 }),
      buildShrugPose,
      { fps: 30, durationMs: 3000 },
    );
    const result = runShrugSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThanOrEqual(2300);
  });

  it('fails the feetStable gate when feet are wider than 1.20× shoulders', () => {
    const frames = buildFrames(
      () => ({ shoulderElevation: 0, feetWidthRatio: 1.40 }),
      buildShrugPose,
      { fps: 30, durationMs: 3000 },
    );
    const result = runShrugSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.checks.feetWide).toBe(false);
  });

  it('fails when key landmarks are occluded (fullBodyVisible gate)', () => {
    const frames = buildFrames(
      () => ({ shoulderElevation: 0, occludedIndices: [IDX.leftElbow] }),
      buildShrugPose,
      { fps: 30, durationMs: 3000 },
    );
    const result = runShrugSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.checks.fullBodyVisible).toBe(false);
  });

  it('never confirms when feet are always too wide (no timeout needed)', () => {
    // Always fails feetWide gate — can never reach confirmed
    const frames = buildFrames(
      () => ({ shoulderElevation: 0, feetWidthRatio: 2.0 }),
      buildShrugPose,
      { fps: 30, durationMs: 5000 },
    );
    const result = runShrugSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeNull();
  });

  it('emits distanceHint=too-far when body height < BODY_HEIGHT_MIN (Fix H)', () => {
    // bodyHeight=0.30 < BODY_HEIGHT_MIN=0.45 → too-far hint
    const frames = buildFrames(
      () => ({ shoulderElevation: 0, bodyHeight: 0.30 }),
      buildShrugPose,
      { fps: 30, durationMs: 2000 },
    );
    const result = runShrugSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.distanceHint).toBe('too-far');
  });

  it('emits distanceHint=too-close when body height > BODY_HEIGHT_MAX (Fix H)', () => {
    // bodyHeight=0.95 > BODY_HEIGHT_MAX=0.92 → too-close hint
    const frames = buildFrames(
      () => ({ shoulderElevation: 0, bodyHeight: 0.95 }),
      buildShrugPose,
      { fps: 30, durationMs: 2000 },
    );
    const result = runShrugSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.distanceHint).toBe('too-close');
  });
});
