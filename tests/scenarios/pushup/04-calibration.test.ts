import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildPushupPose } from '../../harness/pose-stub';
import { runPushupSession } from '../../harness/runner';
import { IDX } from '../../harness/types';

describe('Push-Up — calibration gates', () => {
  it('confirms within 2.2s when all gates pass', () => {
    const frames = buildFrames(
      () => ({ elbowFlexionDeg: 0, side: 'left' as const, bodyLengthX: 0.70 }),
      buildPushupPose,
      { fps: 30, durationMs: 3000 },
    );
    const result = runPushupSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThanOrEqual(2300);
  });

  it('fails when arms are not extended (elbow flex too high at calibration)', () => {
    const frames = buildFrames(
      () => ({ elbowFlexionDeg: 60, side: 'left' as const, bodyLengthX: 0.70 }),
      buildPushupPose,
      { fps: 30, durationMs: 3000 },
    );
    const result = runPushupSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.checks.armsOverhead).toBe(false);
  });

  it('emits too-far hint when body length is small (user too far)', () => {
    const frames = buildFrames(
      () => ({ elbowFlexionDeg: 0, side: 'left' as const, bodyLengthX: 0.35 }),
      buildPushupPose,
      { fps: 30, durationMs: 3000 },
    );
    const result = runPushupSession(frames);
    expect(result.finalCalibration?.checks.distanceOk).toBe(false);
    expect(result.finalCalibration?.distanceHint).toBe('too-far');
  });

  it('emits too-close hint when body fills the frame', () => {
    const frames = buildFrames(
      () => ({ elbowFlexionDeg: 0, side: 'left' as const, bodyLengthX: 0.97 }),
      buildPushupPose,
      { fps: 30, durationMs: 3000 },
    );
    const result = runPushupSession(frames);
    expect(result.finalCalibration?.checks.distanceOk).toBe(false);
    expect(result.finalCalibration?.distanceHint).toBe('too-close');
  });

  it('fails when shoulder is occluded (fullBodyVisible gate)', () => {
    const frames = buildFrames(
      () => ({
        elbowFlexionDeg: 0, side: 'left' as const, bodyLengthX: 0.70,
        occludedIndices: [IDX.leftShoulder],
      }),
      buildPushupPose,
      { fps: 30, durationMs: 3000 },
    );
    const result = runPushupSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.checks.fullBodyVisible).toBe(false);
  });
});
