/**
 * Calibration tests:
 *   - 4 gates pass on a clean T (Fix G instant confirm ~200 ms)
 *   - Torso too upright (not hinged) → fails the T-posture-ready gate
 *   - Back leg not lifted → fails the lifted-leg gate
 *   - Torso length below the floor (too far) → Fix X analog: too-far hint
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildWarrior3Pose } from '../../harness/pose-stub';
import { runWarrior3Session } from '../../harness/runner';
import type { Warrior3PoseIntent } from '../../harness/types';

describe('Warrior III — calibration', () => {
  it('confirms within ~400 ms when all gates pass (Fix G instant)', () => {
    const frames = buildFrames(
      () => ({ torsoPitchFromHorizontalDeg: 10, backLegAngleFromHorizontalDeg: 10 } as Warrior3PoseIntent),
      buildWarrior3Pose,
      { fps: 30, durationMs: 1500 },
    );
    const result = runWarrior3Session(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThanOrEqual(400);
  });

  it('fails the T-posture gate when the torso is too upright', () => {
    const frames = buildFrames(
      () => ({ torsoPitchFromHorizontalDeg: 70, backLegAngleFromHorizontalDeg: 10 } as Warrior3PoseIntent),
      buildWarrior3Pose,
      { fps: 30, durationMs: 1500 },
    );
    const result = runWarrior3Session(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.checks.armsOverhead).toBe(false);
  });

  it('fails the lifted-leg gate when the back leg is not raised', () => {
    // Back leg hanging straight down (≈ standing leg height) → not lifted.
    const frames = buildFrames(
      () => ({ torsoPitchFromHorizontalDeg: 10, backLegAngleFromHorizontalDeg: 85 } as Warrior3PoseIntent),
      buildWarrior3Pose,
      { fps: 30, durationMs: 1500 },
    );
    const result = runWarrior3Session(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.checks.feetWide).toBe(false);
  });

  it('reports too-far when torso length is below the floor (Fix X analog)', () => {
    const frames = buildFrames(
      () => ({ torsoPitchFromHorizontalDeg: 10, backLegAngleFromHorizontalDeg: 10, torsoLen: 0.06 } as Warrior3PoseIntent),
      buildWarrior3Pose,
      { fps: 30, durationMs: 1500 },
    );
    const result = runWarrior3Session(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.distanceHint).toBe('too-far');
    expect(result.finalCalibration?.checks.distanceOk).toBe(false);
  });
});
