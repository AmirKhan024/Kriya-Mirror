/**
 * Calibration tests:
 *   - 4 gates pass on a clean folded pose (Fix G instant confirm ~200ms)
 *   - distanceHint='too-far' when the body span is below the floor (Fix X analog)
 *   - distanceHint='too-close' when the body span overflows the band
 *   - Shallow fold fails the "folded" gate (feetWide remap)
 *   - Bent knees fail the "legs straight" gate (armsOverhead remap)
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildForwardFoldPose } from '../../harness/pose-stub';
import { runStandingForwardFoldSession } from '../../harness/runner';
import type { ForwardFoldPoseIntent } from '../../harness/types';

describe('Standing Forward Fold — calibration', () => {
  it('confirms within ~400ms once all gates are green (Fix G instant calibration)', () => {
    const frames = buildFrames(
      (): ForwardFoldPoseIntent => ({ foldAngleDeg: 75, kneeFlexionDeg: 5, side: 'left' }),
      buildForwardFoldPose,
      { fps: 30, durationMs: 1500 },
    );
    const result = runStandingForwardFoldSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThanOrEqual(400);
  });

  it('reports too-far when the body span is below the floor (Fix X analog)', () => {
    const frames = buildFrames(
      (): ForwardFoldPoseIntent => ({ foldAngleDeg: 75, bodyHeight: 0.30, side: 'left' }),
      buildForwardFoldPose,
      { fps: 30, durationMs: 1500 },
    );
    const result = runStandingForwardFoldSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.distanceHint).toBe('too-far');
    expect(result.finalCalibration?.checks.distanceOk).toBe(false);
  });

  it('reports too-close when the body span overflows the band', () => {
    const frames = buildFrames(
      (): ForwardFoldPoseIntent => ({ foldAngleDeg: 75, bodyHeight: 0.96, side: 'left' }),
      buildForwardFoldPose,
      { fps: 30, durationMs: 1500 },
    );
    const result = runStandingForwardFoldSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.distanceHint).toBe('too-close');
  });

  it('keeps the "folded" gate red when the torso is only half folded', () => {
    const frames = buildFrames(
      (): ForwardFoldPoseIntent => ({ foldAngleDeg: 45, side: 'left' }),
      buildForwardFoldPose,
      { fps: 30, durationMs: 1500 },
    );
    const result = runStandingForwardFoldSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.checks.feetWide).toBe(false); // remap: folded
  });

  it('keeps the "legs straight" gate red when the knees are bent', () => {
    const frames = buildFrames(
      (): ForwardFoldPoseIntent => ({ foldAngleDeg: 75, kneeFlexionDeg: 55, side: 'left' }),
      buildForwardFoldPose,
      { fps: 30, durationMs: 1500 },
    );
    const result = runStandingForwardFoldSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.checks.armsOverhead).toBe(false); // remap: legs straight
  });
});
