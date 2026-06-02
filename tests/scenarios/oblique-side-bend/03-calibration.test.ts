/**
 * Calibration tests:
 *   - 4 gates pass on a clean upright pose (Fix G instant confirm ~200ms)
 *   - Fix X: a tiny shoulderWidth (user too far / edge of frame) → too-far, no confirm
 *   - Already bent at cal fails the uprightTorso gate (armsOverhead slot)
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildObliqueSideBendPose } from '../../harness/pose-stub';
import { runObliqueSideBendSession } from '../../harness/runner';
import type { ObliqueSideBendPoseIntent } from '../../harness/types';

describe('Oblique Side Bend — calibration', () => {
  it('confirms within ~400ms of all gates green (Fix G instant calibration)', () => {
    const frames = buildFrames(
      () => ({ leanDeg: 0 } as ObliqueSideBendPoseIntent),
      buildObliqueSideBendPose,
      { fps: 30, durationMs: 1500 },
    );
    const result = runObliqueSideBendSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThanOrEqual(400);
  });

  it('reports distanceHint=too-far when shoulderWidth is degenerate (Fix X)', () => {
    const frames = buildFrames(
      () => ({ leanDeg: 0, shoulderWidthOverride: 0.05 } as ObliqueSideBendPoseIntent),
      buildObliqueSideBendPose,
      { fps: 30, durationMs: 1500 },
    );
    const result = runObliqueSideBendSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.distanceHint).toBe('too-far');
    expect(result.finalCalibration?.checks.distanceOk).toBe(false);
  });

  it('keeps the uprightTorso gate red when already bent at cal', () => {
    const frames = buildFrames(
      () => ({ leanDeg: 30 } as ObliqueSideBendPoseIntent),
      buildObliqueSideBendPose,
      { fps: 30, durationMs: 1500 },
    );
    const result = runObliqueSideBendSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.checks.armsOverhead).toBe(false); // remap: uprightTorso
  });
});
