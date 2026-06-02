import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildDeadBugPose } from '../../harness/pose-stub';
import { runDeadBugSession } from '../../harness/runner';
import type { DeadBugPoseIntent } from '../../harness/types';

describe('Dead Bug — calibration gates', () => {
  it('Test 1: all gates pass → calibration confirms within 500ms', () => {
    const frames = buildFrames(
      (): DeadBugPoseIntent => ({
        legExtensionDeg: 0,
        armsUp: true,
        visibility: 0.95,
        bodyLengthX: 0.55,
      }),
      buildDeadBugPose,
      { fps: 30, durationMs: 1000 },
    );
    const result = runDeadBugSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThanOrEqual(500);
  });

  it('Test 2: armsUp=false → feetWide / arms gate fails → never confirms', () => {
    const frames = buildFrames(
      (): DeadBugPoseIntent => ({
        legExtensionDeg: 0,
        armsUp: false,
        visibility: 0.95,
        bodyLengthX: 0.55,
      }),
      buildDeadBugPose,
      { fps: 30, durationMs: 2000 },
    );
    const result = runDeadBugSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
  });

  it('Test 3: visibility=0 → fullBodyVisible fails → never confirms', () => {
    const frames = buildFrames(
      (): DeadBugPoseIntent => ({
        legExtensionDeg: 0,
        armsUp: true,
        visibility: 0,
        bodyLengthX: 0.55,
      }),
      buildDeadBugPose,
      { fps: 30, durationMs: 2000 },
    );
    const result = runDeadBugSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
  });

  it('Test 4: distance hint too-far when bodyLengthX < 0.37', () => {
    const frames = buildFrames(
      (): DeadBugPoseIntent => ({
        legExtensionDeg: 0,
        armsUp: true,
        visibility: 0.95,
        bodyLengthX: 0.30,
      }),
      buildDeadBugPose,
      { fps: 30, durationMs: 2000 },
    );
    const result = runDeadBugSession(frames);
    expect(result.finalCalibration?.checks?.distanceOk).toBe(false);
    expect(result.finalCalibration?.distanceHint).toBe('too-far');
  });

  it('Test 5: distance hint too-close when bodyLengthX > 0.73', () => {
    const frames = buildFrames(
      (): DeadBugPoseIntent => ({
        legExtensionDeg: 0,
        armsUp: true,
        visibility: 0.95,
        bodyLengthX: 0.85,
      }),
      buildDeadBugPose,
      { fps: 30, durationMs: 2000 },
    );
    const result = runDeadBugSession(frames);
    expect(result.finalCalibration?.checks?.distanceOk).toBe(false);
    expect(result.finalCalibration?.distanceHint).toBe('too-close');
  });

  it('Test 6: instant confirm <= 500ms when all gates green (Fix G verification)', () => {
    const frames = buildFrames(
      (): DeadBugPoseIntent => ({
        legExtensionDeg: 0,
        armsUp: true,
        visibility: 0.95,
        bodyLengthX: 0.55,
      }),
      buildDeadBugPose,
      { fps: 30, durationMs: 2000 },
    );
    const result = runDeadBugSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThanOrEqual(500);
  });
});
