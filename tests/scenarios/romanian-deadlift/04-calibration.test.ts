/**
 * Romanian Deadlift — calibration gate tests.
 * Verifies each gate independently and instant-confirm behavior.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildRomanianDeadliftPose } from '../../harness/pose-stub';
import { runRDLSession } from '../../harness/runner';
import type { RomanianDeadliftPoseIntent } from '../../harness/types';

describe('Romanian Deadlift — calibration', () => {
  it('confirms quickly when all gates pass (upright, soft bend, good distance)', () => {
    const frames = buildFrames(
      (): RomanianDeadliftPoseIntent => ({ hipHingeDeg: 0, kneeAngleDeg: 15 }),
      buildRomanianDeadliftPose,
      { fps: 30, durationMs: 1000 },
    );
    const result = runRDLSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThan(500);
  });

  it('instant confirm — calibrationConfirmedAtMs ≤ 400ms', () => {
    const frames = buildFrames(
      (): RomanianDeadliftPoseIntent => ({ hipHingeDeg: 0, kneeAngleDeg: 15 }),
      buildRomanianDeadliftPose,
      { fps: 30, durationMs: 600 },
    );
    const result = runRDLSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).not.toBeNull();
    expect(result.calibrationConfirmedAtMs!).toBeLessThanOrEqual(400);
  });

  it('does NOT confirm when user is pre-bent (hip hinge ≥ 20°)', () => {
    const frames = buildFrames(
      (): RomanianDeadliftPoseIntent => ({ hipHingeDeg: 30, kneeAngleDeg: 15 }),
      buildRomanianDeadliftPose,
      { fps: 30, durationMs: 2000 },
    );
    const result = runRDLSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.checks.feetWide).toBe(false);
  });

  it('fullBodyVisible fails when key landmarks are occluded', () => {
    const frames = buildFrames(
      (): RomanianDeadliftPoseIntent => ({
        hipHingeDeg: 0,
        kneeAngleDeg: 15,
        occludedIndices: [11], // left shoulder occluded
      }),
      buildRomanianDeadliftPose,
      { fps: 30, durationMs: 1000 },
    );
    const result = runRDLSession(frames);
    expect(result.finalCalibration?.checks.fullBodyVisible).toBe(false);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
  });

  it('distanceOk is true for default body height (0.62 — in range)', () => {
    const frames = buildFrames(
      (): RomanianDeadliftPoseIntent => ({ hipHingeDeg: 0, kneeAngleDeg: 15 }),
      buildRomanianDeadliftPose,
      { fps: 30, durationMs: 1000 },
    );
    const result = runRDLSession(frames);
    expect(result.finalCalibration?.checks.distanceOk).toBe(true);
  });

  it('times out after 30s without a valid pose', () => {
    const frames = Array.from({ length: 31 * 30 }, (_, i) => ({
      landmarks: null,
      tMs: (i / 30) * 1000,
    }));
    const result = runRDLSession(frames);
    expect(result.finalCalibration?.state).toBe('timeout');
  });
});
