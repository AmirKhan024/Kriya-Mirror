/**
 * Calibration tests:
 *   - 4 gates pass on a clean seated rest pose (Fix G instant confirm ~200ms)
 *   - distanceHint='too-far' when shoulderWidth is degenerate (Fix X)
 *   - A STANDING pose fails the "seated" gate (the chair-vs-person guard)
 *   - One knee lifted at calibration fails the "both knees down" gate
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildSeatedMarchPose, buildHighKneesPose } from '../../harness/pose-stub';
import { runSeatedMarchSession } from '../../harness/runner';
import type { SeatedMarchPoseIntent, HighKneesPoseIntent } from '../../harness/types';

describe('Seated March — calibration', () => {
  it('confirms within ~400ms once all gates are green (Fix G instant calibration)', () => {
    const frames = buildFrames(
      (): SeatedMarchPoseIntent => ({ leftKneeLiftPct: 0, rightKneeLiftPct: 0 }),
      buildSeatedMarchPose,
      { fps: 30, durationMs: 1500 },
    );
    const result = runSeatedMarchSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThanOrEqual(400);
  });

  it('reports too-far when shoulderWidth is below the Fix X floor', () => {
    const frames = buildFrames(
      (): SeatedMarchPoseIntent => ({ leftKneeLiftPct: 0, rightKneeLiftPct: 0, shoulderWidthOverride: 0.05 }),
      buildSeatedMarchPose,
      { fps: 30, durationMs: 1500 },
    );
    const result = runSeatedMarchSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.distanceHint).toBe('too-far');
    expect(result.finalCalibration?.checks.distanceOk).toBe(false);
  });

  it('rejects a STANDING person via the seated gate (chair-vs-person guard)', () => {
    // A standing high-knees silhouette: knees sit far below the hips, so the
    // "seated" gate (knees near hip height) must reject it.
    const frames = buildFrames(
      (): HighKneesPoseIntent => ({ leftKneeLiftPct: 0, rightKneeLiftPct: 0 }),
      buildHighKneesPose,
      { fps: 30, durationMs: 1500 },
    );
    const result = runSeatedMarchSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.checks.feetWide).toBe(false); // remap: seated
  });

  it('rejects calibration when one knee is already lifted (both-knees-down gate)', () => {
    const frames = buildFrames(
      (): SeatedMarchPoseIntent => ({ leftKneeLiftPct: 60, rightKneeLiftPct: 0 }),
      buildSeatedMarchPose,
      { fps: 30, durationMs: 1500 },
    );
    const result = runSeatedMarchSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.checks.armsOverhead).toBe(false); // remap: both knees down
  });
});
