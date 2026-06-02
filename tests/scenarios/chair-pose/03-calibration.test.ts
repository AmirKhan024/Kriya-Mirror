/**
 * Calibration tests:
 *   - 4 gates pass on a clean chair pose (Fix G instant confirm ~200ms)
 *   - distanceHint populates 'too-far' when the user is too small in frame (Fix X analog: small bodyHeight → too-far)
 *   - Arms-down position fails the armsReady gate (calibration stays 'waiting')
 *   - Straight legs (kneeFlexionDeg ≈ 0) fail the kneesBent gate
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildChairPosePose } from '../../harness/pose-stub';
import { runChairPoseSession } from '../../harness/runner';
import type { ChairPosePoseIntent } from '../../harness/types';

describe('Chair Pose — calibration', () => {
  it('confirms within ~300ms of all gates green (Fix G instant calibration)', () => {
    const frames = buildFrames(
      () => ({ kneeFlexionDeg: 90, side: 'left' as const } as ChairPosePoseIntent),
      buildChairPosePose,
      { fps: 30, durationMs: 1500 },
    );
    const result = runChairPoseSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    // 200ms CONFIRM_DURATION + a couple of frames of warm-up = well under 400ms
    expect(result.calibrationConfirmedAtMs).toBeLessThanOrEqual(400);
  });

  it('reports distanceHint=too-far when bodyHeight is below the floor (Fix X analog)', () => {
    // bodyHeight=0.20 is well below MIN_BODY_HEIGHT_RUNTIME=0.30. Calibration
    // must refuse to confirm and surface 'too-far' for the user to step closer.
    const frames = buildFrames(
      () => ({ kneeFlexionDeg: 90, bodyHeight: 0.20, side: 'left' as const } as ChairPosePoseIntent),
      buildChairPosePose,
      { fps: 30, durationMs: 1500 },
    );
    const result = runChairPoseSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.distanceHint).toBe('too-far');
    expect(result.finalCalibration?.checks.distanceOk).toBe(false);
  });

  it('reports distanceHint=too-close when bodyHeight overflows the band', () => {
    // bodyHeight=0.95 is above MAX_BODY_HEIGHT_ENTER=0.88 → too-close.
    const frames = buildFrames(
      () => ({ kneeFlexionDeg: 90, bodyHeight: 0.95, side: 'left' as const } as ChairPosePoseIntent),
      buildChairPosePose,
      { fps: 30, durationMs: 1500 },
    );
    const result = runChairPoseSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.distanceHint).toBe('too-close');
  });

  it('keeps the kneesBent gate red when the user is standing straight', () => {
    const frames = buildFrames(
      () => ({ kneeFlexionDeg: 10, side: 'left' as const } as ChairPosePoseIntent),
      buildChairPosePose,
      { fps: 30, durationMs: 1500 },
    );
    const result = runChairPoseSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.checks.feetWide).toBe(false); // remap: kneesBent
  });

  it('keeps the armsReady gate red when arms are hanging at sides', () => {
    const frames = buildFrames(
      () => ({ kneeFlexionDeg: 90, armsExtended: false, side: 'left' as const } as ChairPosePoseIntent),
      buildChairPosePose,
      { fps: 30, durationMs: 1500 },
    );
    const result = runChairPoseSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.checks.armsOverhead).toBe(false); // remap: armsReady
  });
});
