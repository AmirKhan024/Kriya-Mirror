import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildHammerCurlPose } from '../../harness/pose-stub';
import { runHammerCurlSession } from '../../harness/runner';
import { IDX } from '../../harness/types';

describe('Hammer Curl — calibration gates', () => {
  it('confirms within 2.2s when all gates pass', () => {
    const frames = buildFrames(
      () => ({ elbowFlexionDeg: 0 }),
      buildHammerCurlPose,
      { fps: 30, durationMs: 3000 },
    );
    const result = runHammerCurlSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThanOrEqual(2300);
  });

  it('fails the armsExtended gate when arms are mid-curl (flex too high)', () => {
    const frames = buildFrames(
      () => ({ elbowFlexionDeg: 60 }),     // > 25° threshold → fails armsExtended
      buildHammerCurlPose,
      { fps: 30, durationMs: 3000 },
    );
    const result = runHammerCurlSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.checks.armsOverhead).toBe(false);
  });

  it('fails the feetStable gate when feet are wider than 1.20× shoulders', () => {
    const frames = buildFrames(
      () => ({ elbowFlexionDeg: 0, feetWidthRatio: 1.40 }),
      buildHammerCurlPose,
      { fps: 30, durationMs: 3000 },
    );
    const result = runHammerCurlSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.checks.feetWide).toBe(false);
  });

  it('fails when key landmarks are occluded (fullBodyVisible gate)', () => {
    const frames = buildFrames(
      () => ({ elbowFlexionDeg: 0, occludedIndices: [IDX.leftElbow] }),
      buildHammerCurlPose,
      { fps: 30, durationMs: 3000 },
    );
    const result = runHammerCurlSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.checks.fullBodyVisible).toBe(false);
  });
});
