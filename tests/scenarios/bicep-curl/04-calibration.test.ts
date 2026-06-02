import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildBicepCurlPose } from '../../harness/pose-stub';
import { runBicepCurlSession } from '../../harness/runner';
import { IDX } from '../../harness/types';

describe('Bicep Curl — calibration gates', () => {
  it('confirms within 2.2s when all gates pass', () => {
    const frames = buildFrames(
      () => ({ elbowFlexionDeg: 0 }),
      buildBicepCurlPose,
      { fps: 30, durationMs: 3000 },
    );
    const result = runBicepCurlSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThanOrEqual(2300);
  });

  it('fails the armsExtended gate when arms are mid-curl (flex too high)', () => {
    const frames = buildFrames(
      () => ({ elbowFlexionDeg: 60 }),     // > 25° threshold → fails armsExtended
      buildBicepCurlPose,
      { fps: 30, durationMs: 3000 },
    );
    const result = runBicepCurlSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.checks.armsOverhead).toBe(false);
  });

  it('fails the feetStable gate when feet are wider than 1.20× shoulders', () => {
    const frames = buildFrames(
      () => ({ elbowFlexionDeg: 0, feetWidthRatio: 1.40 }),
      buildBicepCurlPose,
      { fps: 30, durationMs: 3000 },
    );
    const result = runBicepCurlSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.checks.feetWide).toBe(false);
  });

  it('fails when key landmarks are occluded (fullBodyVisible gate)', () => {
    const frames = buildFrames(
      () => ({ elbowFlexionDeg: 0, occludedIndices: [IDX.leftElbow] }),
      buildBicepCurlPose,
      { fps: 30, durationMs: 3000 },
    );
    const result = runBicepCurlSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.checks.fullBodyVisible).toBe(false);
  });
});
