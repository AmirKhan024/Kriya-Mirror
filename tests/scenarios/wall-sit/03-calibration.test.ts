/**
 * Calibration tests:
 *   - 4 gates pass on a clean wall sit (Fix G instant confirm ~200ms)
 *   - distanceHint populates 'too-far' when bodyHeight is below the floor
 *     (Fix X analog: small bodyHeight → too-far)
 *   - distanceHint populates 'too-close' when bodyHeight overflows the band
 *   - Straight legs (kneeFlexionDeg ≈ 0) fail the kneesBent gate (feetWide slot)
 *   - Leaning off the wall at cal fails the backUpright gate (armsOverhead slot)
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildWallSitPose } from '../../harness/pose-stub';
import { runWallSitSession } from '../../harness/runner';
import type { WallSitPoseIntent } from '../../harness/types';

describe('Wall Sit — calibration', () => {
  it('confirms within ~400ms of all gates green (Fix G instant calibration)', () => {
    const frames = buildFrames(
      () => ({ kneeFlexionDeg: 90, trunkLeanDeg: 4, side: 'left' as const } as WallSitPoseIntent),
      buildWallSitPose,
      { fps: 30, durationMs: 1500 },
    );
    const result = runWallSitSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThanOrEqual(400);
  });

  it('reports distanceHint=too-far when bodyHeight is below the floor (Fix X analog)', () => {
    const frames = buildFrames(
      () => ({ kneeFlexionDeg: 90, bodyHeight: 0.20, side: 'left' as const } as WallSitPoseIntent),
      buildWallSitPose,
      { fps: 30, durationMs: 1500 },
    );
    const result = runWallSitSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.distanceHint).toBe('too-far');
    expect(result.finalCalibration?.checks.distanceOk).toBe(false);
  });

  it('reports distanceHint=too-close when bodyHeight overflows the band', () => {
    const frames = buildFrames(
      () => ({ kneeFlexionDeg: 90, bodyHeight: 0.95, side: 'left' as const } as WallSitPoseIntent),
      buildWallSitPose,
      { fps: 30, durationMs: 1500 },
    );
    const result = runWallSitSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.distanceHint).toBe('too-close');
  });

  it('keeps the kneesBent gate red when the user is standing straight', () => {
    const frames = buildFrames(
      () => ({ kneeFlexionDeg: 10, side: 'left' as const } as WallSitPoseIntent),
      buildWallSitPose,
      { fps: 30, durationMs: 1500 },
    );
    const result = runWallSitSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.checks.feetWide).toBe(false); // remap: kneesBent
  });

  it('keeps the backUpright gate red when the user is leaning forward at cal', () => {
    const frames = buildFrames(
      () => ({ kneeFlexionDeg: 90, trunkLeanDeg: 45, side: 'left' as const } as WallSitPoseIntent),
      buildWallSitPose,
      { fps: 30, durationMs: 1500 },
    );
    const result = runWallSitSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.checks.armsOverhead).toBe(false); // remap: backUpright
  });
});
