/**
 * Calibration tests:
 *   - 4 gates pass on a clean Tadasana (Fix G instant confirm)
 *   - Wide feet stance (not Tadasana) → fails feetCloseTogether gate
 *   - Arms at sides → fails armsOverhead gate (Tadasana requires arms overhead)
 *   - Narrow shoulderWidth (Fix X) → reject as too-far
 *
 * 2026-05-28 round 20 — calf-raise (heels-lifted) layer rolled back per user
 * direction. The "heels not lifted" failure case from round 19 has been
 * deleted; the pose is now just feet-together + arms-overhead.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildMountainPosePose } from '../../harness/pose-stub';
import { runMountainPoseSession } from '../../harness/runner';
import type { MountainPosePoseIntent } from '../../harness/types';

describe('Mountain Pose — calibration', () => {
  it('confirms within ~400ms when all gates pass (Fix G instant)', () => {
    const frames = buildFrames(
      () => ({} as MountainPosePoseIntent),
      buildMountainPosePose,
      { fps: 30, durationMs: 1500 },
    );
    const result = runMountainPoseSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThanOrEqual(400);
  });

  it('fails feetCloseTogether when ankles are wide apart', () => {
    // ankleXDistance 0.12 / shoulderWidth 0.16 = 0.75 → above 0.50 threshold.
    const frames = buildFrames(
      () => ({ ankleXDistance: 0.12 } as MountainPosePoseIntent),
      buildMountainPosePose,
      { fps: 30, durationMs: 1500 },
    );
    const result = runMountainPoseSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.checks.feetWide).toBe(false);
  });

  it('fails armsOverhead gate when arms are at sides (Tadasana requires overhead reach)', () => {
    const frames = buildFrames(
      () => ({ armsRaised: false } as MountainPosePoseIntent),
      buildMountainPosePose,
      { fps: 30, durationMs: 1500 },
    );
    const result = runMountainPoseSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.checks.armsOverhead).toBe(false);
  });

  it('rejects narrow-shoulderWidth baseline as too-far (Fix X)', () => {
    const frames = buildFrames(
      () => ({ shoulderWidthOverride: 0.05 } as MountainPosePoseIntent),
      buildMountainPosePose,
      { fps: 30, durationMs: 1500 },
    );
    const result = runMountainPoseSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.distanceHint).toBe('too-far');
    expect(result.finalCalibration?.checks.distanceOk).toBe(false);
  });
});
