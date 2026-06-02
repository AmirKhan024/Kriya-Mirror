import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildOTEPose } from '../../harness/pose-stub';
import { runOTESession } from '../../harness/runner';

describe('Overhead Tricep Extension — calibration', () => {
  it('confirms quickly (≤ 500ms) when all gates pass', () => {
    const frames = buildFrames(
      () => ({ extensionLevel: 1.0 }),
      buildOTEPose,
      { fps: 30, durationMs: 1000 },
    );
    const result = runOTESession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThanOrEqual(500);
  });

  it('does NOT confirm when wrists are NOT above elbows (arms hanging down)', () => {
    // extensionLevel=-0.5 → wristY = elbowY + 0.065 (wrists BELOW elbows)
    const frames = buildFrames(
      () => ({ extensionLevel: -0.5 }),
      buildOTEPose,
      { fps: 30, durationMs: 1000 },
    );
    const result = runOTESession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.checks.armsOverhead).toBe(false);
  });

  it('emits distanceHint "too-close" when body fills too much of the frame', () => {
    // bodyHeight = 0.95 > BODY_HEIGHT_MAX (0.92) → too-close
    const frames = buildFrames(
      () => ({ extensionLevel: 1.0, bodyHeight: 0.95 }),
      buildOTEPose,
      { fps: 30, durationMs: 600 },
    );
    const result = runOTESession(frames);
    expect(result.finalCalibration?.distanceHint).toBe('too-close');
    expect(result.finalCalibration?.checks.distanceOk).toBe(false);
  });

  it('emits distanceHint "too-far" when body is too small in frame', () => {
    // bodyHeight = 0.30 < BODY_HEIGHT_MIN (0.45) → too-far
    const frames = buildFrames(
      () => ({ extensionLevel: 1.0, bodyHeight: 0.30 }),
      buildOTEPose,
      { fps: 30, durationMs: 600 },
    );
    const result = runOTESession(frames);
    expect(result.finalCalibration?.distanceHint).toBe('too-far');
    expect(result.finalCalibration?.checks.distanceOk).toBe(false);
  });

  it('fails calibration when feet are too wide', () => {
    // feetWidthRatio=1.50 > MAX_FEET_RATIO=1.20
    const frames = buildFrames(
      () => ({ extensionLevel: 1.0, feetWidthRatio: 1.50 }),
      buildOTEPose,
      { fps: 30, durationMs: 600 },
    );
    const result = runOTESession(frames);
    expect(result.finalCalibration?.checks.feetWide).toBe(false);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
  });

  it('does not confirm when arms are only partially raised (elbows not clearly above shoulders)', () => {
    // extensionLevel=0.3, but the key issue is the armsOverhead gate:
    // Need wrists above elbows by >= 0.04 AND elbows above shoulders by >= 0.04.
    // At extensionLevel=0.3: wristY = elbowY - 0.13*0.3 = elbowY - 0.039.
    // le.y - lw.y = 0.039 < ARMS_OVERHEAD_Y_MIN (0.04) → gate fails.
    const frames = buildFrames(
      () => ({ extensionLevel: 0.30 }),
      buildOTEPose,
      { fps: 30, durationMs: 600 },
    );
    const result = runOTESession(frames);
    expect(result.finalCalibration?.checks.armsOverhead).toBe(false);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
  });
});
