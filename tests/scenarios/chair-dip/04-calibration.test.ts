/**
 * Chair Dip — calibration gate tests.
 *
 * ChairDipCalibration gates (remapped from squat's names):
 *   fullBodyVisible — shoulders + elbows + wrists + hips + ankles all visible
 *   feetWide        — feetStable: feet width ≤ 1.20× shoulder width
 *   armsOverhead    — armsExtended: BOTH elbows at flex < 30° (ARMS_EXTENDED_FLEX_MAX)
 *   distanceOk      — body span (|ankleY - shoulderY|) in [0.45, 0.92]
 *
 * CONFIRM_DURATION_MS = 200ms (round-5 instant-confirm).
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildChairDipPose } from '../../harness/pose-stub';
import { runChairDipSession } from '../../harness/runner';
import { IDX } from '../../harness/types';
import type { ChairDipPoseIntent } from '../../harness/types';

describe('Chair Dip — calibration gates', () => {
  it('Test A — confirms within 500ms when all gates pass', () => {
    // All gates green: fullBodyVisible=true, feetWidthRatio=1.0 (≤1.20),
    // elbowFlexionDeg=5 (< 30), bodyHeight=0.70 (in [0.45, 0.92]).
    const frames = buildFrames(
      () => ({ elbowFlexionDeg: 5, feetWidthRatio: 1.0, bodyHeight: 0.70 } as ChairDipPoseIntent),
      buildChairDipPose,
      { fps: 30, durationMs: 1000 },
    );
    const result = runChairDipSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).not.toBeNull();
    expect(result.calibrationConfirmedAtMs!).toBeLessThanOrEqual(500);
  });

  it('Test B — fullBodyVisible gate: occluded left shoulder → NOT confirmed', () => {
    // Occlude left shoulder → fullBodyVisible=false. All other parameters green.
    const frames = buildFrames(
      () => ({
        elbowFlexionDeg: 5,
        feetWidthRatio: 1.0,
        bodyHeight: 0.70,
        occludedIndices: [IDX.leftShoulder],
      } as ChairDipPoseIntent),
      buildChairDipPose,
      { fps: 30, durationMs: 3000 },
    );
    const result = runChairDipSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.checks.fullBodyVisible).toBe(false);
  });

  it('Test C — arms not extended gate: elbowFlexionDeg=35 > ARMS_EXTENDED_FLEX_MAX(30) → NOT confirmed', () => {
    // Both arms at 35° flex → armsOverhead (armsExtended) gate fails.
    const frames = buildFrames(
      () => ({
        elbowFlexionDeg: 35,
        feetWidthRatio: 1.0,
        bodyHeight: 0.70,
      } as ChairDipPoseIntent),
      buildChairDipPose,
      { fps: 30, durationMs: 3000 },
    );
    const result = runChairDipSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.checks.armsOverhead).toBe(false);
  });

  it('Test D — too close: bodyHeight=0.95 > BODY_HEIGHT_MAX(0.92) → distanceOk=false, distanceHint=too-close', () => {
    const frames = buildFrames(
      () => ({
        elbowFlexionDeg: 5,
        feetWidthRatio: 1.0,
        bodyHeight: 0.95,
      } as ChairDipPoseIntent),
      buildChairDipPose,
      { fps: 30, durationMs: 3000 },
    );
    const result = runChairDipSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.checks.distanceOk).toBe(false);
    expect(result.finalCalibration?.distanceHint).toBe('too-close');
  });

  it('Test E — too far: bodyHeight=0.40 < BODY_HEIGHT_MIN(0.45) → distanceOk=false, distanceHint=too-far', () => {
    const frames = buildFrames(
      () => ({
        elbowFlexionDeg: 5,
        feetWidthRatio: 1.0,
        bodyHeight: 0.40,
      } as ChairDipPoseIntent),
      buildChairDipPose,
      { fps: 30, durationMs: 3000 },
    );
    const result = runChairDipSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.checks.distanceOk).toBe(false);
    expect(result.finalCalibration?.distanceHint).toBe('too-far');
  });

  it('Test F — instant confirm: once all gates green, confirms within ~300ms (200ms CONFIRM_DURATION + buffer)', () => {
    // Run 500ms with all gates passing. CONFIRM_DURATION_MS=200ms so
    // calibration should confirm well within the first 300ms of green frames.
    const frames = buildFrames(
      () => ({
        elbowFlexionDeg: 5,
        feetWidthRatio: 1.0,
        bodyHeight: 0.70,
      } as ChairDipPoseIntent),
      buildChairDipPose,
      { fps: 30, durationMs: 500 },
    );
    const result = runChairDipSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).not.toBeNull();
    // 200ms CONFIRM_DURATION + ~100ms buffer for frame quantisation at 30fps
    expect(result.calibrationConfirmedAtMs!).toBeLessThanOrEqual(300);
  });
});
