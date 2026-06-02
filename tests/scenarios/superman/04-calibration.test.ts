import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildSupermanPose } from '../../harness/pose-stub';
import { runSupermanSession } from '../../harness/runner';
import type { SupermanPoseIntent } from '../../harness/types';

describe('Superman — calibration gates', () => {
  it('all gates pass → calibration confirms within 500ms', () => {
    const frames = buildFrames(
      (): SupermanPoseIntent => ({
        shoulderRise: 0,
        armsForward: true,
        visibility: 0.95,
        bodyLengthX: 0.55,
      }),
      buildSupermanPose,
      { fps: 30, durationMs: 1000 },
    );
    const result = runSupermanSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThanOrEqual(500);
  });

  it('armsForward=false → armsOverhead gate fails → never confirms', () => {
    const frames = buildFrames(
      (): SupermanPoseIntent => ({
        shoulderRise: 0,
        armsForward: false,
        visibility: 0.95,
        bodyLengthX: 0.55,
      }),
      buildSupermanPose,
      { fps: 30, durationMs: 2000 },
    );
    const result = runSupermanSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
  });

  it('visibility=0 → fullBodyVisible fails → never confirms', () => {
    const frames = buildFrames(
      (): SupermanPoseIntent => ({
        shoulderRise: 0,
        armsForward: true,
        visibility: 0,
        bodyLengthX: 0.55,
      }),
      buildSupermanPose,
      { fps: 30, durationMs: 2000 },
    );
    const result = runSupermanSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
  });

  it('distance hint too-far fires when bodyLengthX < 0.37 (Fix H)', () => {
    const frames = buildFrames(
      (): SupermanPoseIntent => ({
        shoulderRise: 0,
        armsForward: true,
        visibility: 0.95,
        bodyLengthX: 0.30,
      }),
      buildSupermanPose,
      { fps: 30, durationMs: 2000 },
    );
    const result = runSupermanSession(frames);
    expect(result.finalCalibration?.checks?.distanceOk).toBe(false);
    expect(result.finalCalibration?.distanceHint).toBe('too-far');
  });

  it('distance hint too-close fires when bodyLengthX > 0.73 (Fix H)', () => {
    const frames = buildFrames(
      (): SupermanPoseIntent => ({
        shoulderRise: 0,
        armsForward: true,
        visibility: 0.95,
        bodyLengthX: 0.85,
      }),
      buildSupermanPose,
      { fps: 30, durationMs: 2000 },
    );
    const result = runSupermanSession(frames);
    expect(result.finalCalibration?.checks?.distanceOk).toBe(false);
    expect(result.finalCalibration?.distanceHint).toBe('too-close');
  });

  it('instant confirm ≤ 500ms when all gates green (Fix G verification)', () => {
    const frames = buildFrames(
      (): SupermanPoseIntent => ({
        shoulderRise: 0,
        armsForward: true,
        visibility: 0.95,
        bodyLengthX: 0.55,
      }),
      buildSupermanPose,
      { fps: 30, durationMs: 2000 },
    );
    const result = runSupermanSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThanOrEqual(500);
  });

  it('hips-lifted pose (hipLiftOff=0.20) → hips-down gate fails → never confirms', () => {
    // In buildSupermanPose: when shoulderRise > 0, hip lifts. However the
    // calibration gate checks hip.y >= 0.60. Let's simulate by raising hips.
    // We set hipLiftOff > 0.16 so hipY = 0.76 - 0.16 = 0.60 exactly (boundary).
    // Let's use 0.20 to push below 0.60 and fail the gate.
    const frames = buildFrames(
      (): SupermanPoseIntent => ({
        shoulderRise: 0,
        hipLiftOff: 0.20,  // hipY = 0.76 - 0.20 = 0.56 < 0.60 → fails hipsDown gate
        armsForward: true,
        visibility: 0.95,
        bodyLengthX: 0.55,
      }),
      buildSupermanPose,
      { fps: 30, durationMs: 2000 },
    );
    const result = runSupermanSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
  });

  it('calibration stays waiting when armsForward=false for extended duration', () => {
    // Without armsForward, the armsOverhead gate fails. State stays 'waiting'.
    const frames = buildFrames(
      (): SupermanPoseIntent => ({
        shoulderRise: 0,
        armsForward: false,
        visibility: 0.95,
        bodyLengthX: 0.55,
      }),
      buildSupermanPose,
      { fps: 30, durationMs: 5000 },
    );
    const result = runSupermanSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
  });
});
