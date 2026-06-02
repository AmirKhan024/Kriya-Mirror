import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildPlankPose } from '../../harness/pose-stub';
import { runPlankSession } from '../../harness/runner';
import { IDX } from '../../harness/types';

describe('Plank — calibration gates', () => {
  it('confirms within 2.2s when all gates pass', () => {
    const frames = buildFrames(
      () => ({ hipDelta: 0, side: 'left' as const, bodyLengthX: 0.70 }),
      buildPlankPose,
      { fps: 30, durationMs: 3000 },
    );
    const result = runPlankSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThanOrEqual(2300);
  });

  it('fails when body length in frame is too small (too-far hint)', () => {
    const frames = buildFrames(
      () => ({ hipDelta: 0, side: 'left' as const, bodyLengthX: 0.35 }), // < MIN_BODY_LENGTH_X=0.45
      buildPlankPose,
      { fps: 30, durationMs: 3000 },
    );
    const result = runPlankSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.distanceHint).toBe('too-far');
  });

  it('fails when body fills too much of frame (too-close hint)', () => {
    const frames = buildFrames(
      () => ({ hipDelta: 0, side: 'left' as const, bodyLengthX: 0.97 }),
      buildPlankPose,
      { fps: 30, durationMs: 3000 },
    );
    const result = runPlankSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.distanceHint).toBe('too-close');
  });

  it('fails when key side landmarks are occluded', () => {
    const frames = buildFrames(
      () => ({
        hipDelta: 0, side: 'left' as const, bodyLengthX: 0.70,
        occludedIndices: [IDX.leftAnkle, IDX.leftHip],
      }),
      buildPlankPose,
      { fps: 30, durationMs: 3000 },
    );
    const result = runPlankSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.checks.fullBodyVisible).toBe(false);
  });
});
