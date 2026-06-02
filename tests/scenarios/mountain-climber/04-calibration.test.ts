/**
 * Mountain Climber — calibration tests
 *
 * Covers:
 *   - Instant calibration (CONFIRM_DURATION_MS = 200ms) in a clean plank position
 *   - Distance hint (too-far) when body is too small in frame
 *   - Distance hint (too-close) when body fills too much of the frame
 *   - Calibration timeout at 30s when user never gets into correct position
 *   - Gates fail when body is not horizontal (vertical body)
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildMountainClimberPose } from '../../harness/pose-stub';
import { runMountainClimberSession } from '../../harness/runner';
import type { MountainClimberPoseIntent } from '../../harness/types';

describe('Mountain Climber — calibration', () => {
  it('confirms quickly in a clean plank position (within 500ms)', () => {
    const frames = buildFrames(
      (): MountainClimberPoseIntent => ({ kneeHipAngleDeg: 170, bodyLength: 0.55 }),
      buildMountainClimberPose,
      { fps: 30, durationMs: 600 },
    );
    const result = runMountainClimberSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).not.toBeNull();
    expect(result.calibrationConfirmedAtMs!).toBeLessThanOrEqual(500);
  });

  it('confirms in under 400ms at 30fps (CONFIRM_DURATION_MS = 200)', () => {
    // At 30fps, frames are 33ms apart. Need 200ms of good frames = ~6 frames.
    const frames = buildFrames(
      (): MountainClimberPoseIntent => ({ kneeHipAngleDeg: 170, bodyLength: 0.55 }),
      buildMountainClimberPose,
      { fps: 30, durationMs: 400 },
    );
    const result = runMountainClimberSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs!).toBeLessThan(400);
  });

  it('emits too-far distanceHint when bodyLength is too small (0.30)', () => {
    // bodyLength 0.30 < MIN_BODY_LENGTH_X 0.45 → too-far
    const frames = buildFrames(
      (): MountainClimberPoseIntent => ({ kneeHipAngleDeg: 170, bodyLength: 0.30 }),
      buildMountainClimberPose,
      { fps: 30, durationMs: 600 },
    );
    const result = runMountainClimberSession(frames);
    // Should not confirm (distance gate fails)
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.distanceHint).toBe('too-far');
    expect(result.finalCalibration?.checks.distanceOk).toBe(false);
  });

  it('emits too-close distanceHint when bodyLength is too large (0.97)', () => {
    // bodyLength 0.97 > MAX_BODY_LENGTH_X 0.95 → too-close
    const frames = buildFrames(
      (): MountainClimberPoseIntent => ({ kneeHipAngleDeg: 170, bodyLength: 0.97 }),
      buildMountainClimberPose,
      { fps: 30, durationMs: 600 },
    );
    const result = runMountainClimberSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.distanceHint).toBe('too-close');
    expect(result.finalCalibration?.checks.distanceOk).toBe(false);
  });

  it('times out at 30s when user never enters correct position', () => {
    // The calibration engine uses `performance.now()` for the start time (real clock)
    // but receives `tMs` from the runner (simulated clock). To trigger the 30s timeout,
    // we set `startAt` well beyond 30_000ms so the first frame's tMs already exceeds
    // the timeout threshold.
    const frames = buildFrames(
      () => null,
      buildMountainClimberPose,
      { fps: 1, durationMs: 1000, startAt: 31_000 },
    );
    const result = runMountainClimberSession(frames);
    expect(result.finalCalibration?.state).toBe('timeout');
    expect(result.calibrationConfirmedAtMs).toBeNull();
  });

  it('checks.fullBodyVisible fails when landmarks are null', () => {
    const frames = buildFrames(
      () => null,
      buildMountainClimberPose,
      { fps: 30, durationMs: 200 },
    );
    const result = runMountainClimberSession(frames);
    expect(result.finalCalibration?.checks.fullBodyVisible).toBe(false);
    expect(result.finalCalibration?.checks.feetWide).toBe(false);
    expect(result.finalCalibration?.checks.distanceOk).toBe(false);
  });
});
