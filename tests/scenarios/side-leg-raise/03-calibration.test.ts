/**
 * Calibration tests:
 *   - 4 gates pass on a clean standing pose (Fix G instant confirm ~200ms)
 *   - Fix X: a tiny shoulderWidth (user too far / edge of frame) → too-far, no confirm
 *   - A leg already raised at cal fails the bothLegsDown gate (armsOverhead slot)
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildSideLegRaisePose } from '../../harness/pose-stub';
import { runSideLegRaiseSession } from '../../harness/runner';
import type { SideLegRaisePoseIntent } from '../../harness/types';

describe('Side Leg Raise — calibration', () => {
  it('confirms within ~400ms of all gates green (Fix G instant calibration)', () => {
    const frames = buildFrames(
      () => ({ leftAbductionDeg: 0, rightAbductionDeg: 0 } as SideLegRaisePoseIntent),
      buildSideLegRaisePose,
      { fps: 30, durationMs: 1500 },
    );
    const result = runSideLegRaiseSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThanOrEqual(400);
  });

  it('reports distanceHint=too-far when shoulderWidth is degenerate (Fix X)', () => {
    const frames = buildFrames(
      () => ({ leftAbductionDeg: 0, rightAbductionDeg: 0, shoulderWidthOverride: 0.05 } as SideLegRaisePoseIntent),
      buildSideLegRaisePose,
      { fps: 30, durationMs: 1500 },
    );
    const result = runSideLegRaiseSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.distanceHint).toBe('too-far');
    expect(result.finalCalibration?.checks.distanceOk).toBe(false);
  });

  it('keeps the bothLegsDown gate red when a leg is already raised at cal', () => {
    const frames = buildFrames(
      () => ({ leftAbductionDeg: 35, rightAbductionDeg: 0 } as SideLegRaisePoseIntent),
      buildSideLegRaisePose,
      { fps: 30, durationMs: 1500 },
    );
    const result = runSideLegRaiseSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.checks.armsOverhead).toBe(false); // remap: bothLegsDown
  });
});
