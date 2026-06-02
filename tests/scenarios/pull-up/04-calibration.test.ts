import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildPullUpPose } from '../../harness/pose-stub';
import { runPullUpSession } from '../../harness/runner';
import type { PullUpPoseIntent } from '../../harness/types';

describe('Pull-Up — calibration gates', () => {
  it('confirms calibration when dead hang is held for 200ms+', () => {
    const frames = buildFrames(
      () => ({ elbowFlexionDeg: 0 } as PullUpPoseIntent),
      buildPullUpPose,
      { fps: 30, durationMs: 1000 },
    );
    const result = runPullUpSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThan(500);
  });

  it('does NOT confirm when arms are bent (armsExtended gate fails, flex >= 25°)', () => {
    // flex=60° → both elbows bend > 25° → armsExtended gate fails
    const frames = buildFrames(
      () => ({ elbowFlexionDeg: 60 } as PullUpPoseIntent),
      buildPullUpPose,
      { fps: 30, durationMs: 1000 },
    );
    const result = runPullUpSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.checks.armsOverhead).toBe(false);
  });

  it('wristsAboveShoulder gate passes when hanging correctly (sanity)', () => {
    // In a valid hanging pose, wrists at barY=0.08 are always above shoulder by ~0.26,
    // well above the WRISTS_ABOVE_OFFSET=0.08 threshold.
    const frames = buildFrames(
      () => ({ elbowFlexionDeg: 0 } as PullUpPoseIntent),
      buildPullUpPose,
      { fps: 30, durationMs: 500 },
    );
    const result = runPullUpSession(frames);
    expect(result.finalCalibration?.checks.feetWide).toBe(true);
  });

  it('does NOT confirm when bodyHeightScale is too small (distance too-far gate)', () => {
    // bodyHeightScale=0.5 → bodyHeight = TORSO + LEG*0.5 = 0.20 + 0.15 = 0.35 < 0.40
    const frames = buildFrames(
      () => ({ elbowFlexionDeg: 0, bodyHeightScale: 0.5 } as PullUpPoseIntent),
      buildPullUpPose,
      { fps: 30, durationMs: 1000 },
    );
    const result = runPullUpSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.checks.distanceOk).toBe(false);
    expect(result.finalCalibration?.distanceHint).toBe('too-far');
  });

  it('does NOT confirm when bodyHeightScale is too large (distance too-close gate)', () => {
    // bodyHeightScale=2.5 → bodyHeight = 0.20 + 0.75 = 0.95 > 0.90
    const frames = buildFrames(
      () => ({ elbowFlexionDeg: 0, bodyHeightScale: 2.5 } as PullUpPoseIntent),
      buildPullUpPose,
      { fps: 30, durationMs: 1000 },
    );
    const result = runPullUpSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.checks.distanceOk).toBe(false);
    expect(result.finalCalibration?.distanceHint).toBe('too-close');
  });

  it('fullBodyVisible gate fails when landmarks are occluded', () => {
    const frames = buildFrames(
      () => ({ elbowFlexionDeg: 0, occludedIndices: [11, 12] } as PullUpPoseIntent),
      buildPullUpPose,
      { fps: 30, durationMs: 1000 },
    );
    const result = runPullUpSession(frames);
    expect(result.finalCalibration?.checks.fullBodyVisible).toBe(false);
  });
});
