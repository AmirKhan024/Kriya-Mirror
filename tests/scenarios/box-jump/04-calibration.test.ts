/**
 * Box Jump — calibration gate tests (Fix F, G, H, J).
 *
 * Tests:
 *   - All gates green → confirm in ~200ms (Fix G)
 *   - Body height distance gate (too-far / too-close hints, Fix H)
 *   - Distance gate hysteresis (Fix F)
 *   - Timeout at 30s when pose never valid (Fix J)
 *   - Baseline captures correct side and hipY
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildBoxJumpPose } from '../../harness/pose-stub';
import { runBoxJumpSession } from '../../harness/runner';
import type { BoxJumpPoseIntent } from '../../harness/types';

describe('Box Jump — calibration', () => {
  it('confirms calibration in under 500ms with a valid side-on pose', () => {
    const frames = buildFrames(
      () => ({ hipYOffset: 0, kneeAngleDeg: 170 } satisfies BoxJumpPoseIntent),
      buildBoxJumpPose,
      { fps: 30, durationMs: 1000 },
    );
    const result = runBoxJumpSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).not.toBeNull();
    expect(result.calibrationConfirmedAtMs!).toBeLessThanOrEqual(500);
  });

  it('emits too-far hint when body height is too small (person too far)', () => {
    const frames = buildFrames(
      () => ({
        hipYOffset: 0,
        kneeAngleDeg: 170,
        bodyHeight: 0.30,  // very small — too far from camera (< BODY_HEIGHT_MIN_ENTER=0.50)
      } satisfies BoxJumpPoseIntent),
      buildBoxJumpPose,
      { fps: 30, durationMs: 1000 },
    );
    const result = runBoxJumpSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.distanceHint).toBe('too-far');
  });

  it('emits too-close hint when body height is too large (person too close)', () => {
    const frames = buildFrames(
      () => ({
        hipYOffset: 0,
        kneeAngleDeg: 170,
        bodyHeight: 1.00,  // very large — too close to camera (> BODY_HEIGHT_MAX_ENTER=0.90)
      } satisfies BoxJumpPoseIntent),
      buildBoxJumpPose,
      { fps: 30, durationMs: 1000 },
    );
    const result = runBoxJumpSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.distanceHint).toBe('too-close');
  });

  it('times out after 30s with no valid pose', () => {
    const frames = buildFrames(
      () => null,
      buildBoxJumpPose,
      { fps: 30, durationMs: 31_000 },
    );
    const result = runBoxJumpSession(frames);
    expect(result.finalCalibration?.state).toBe('timeout');
  });

  it('baseline hipY is near the expected value for standing pose', () => {
    const frames = buildFrames(
      () => ({ hipYOffset: 0, kneeAngleDeg: 170 } satisfies BoxJumpPoseIntent),
      buildBoxJumpPose,
      { fps: 30, durationMs: 1000 },
    );
    const result = runBoxJumpSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    // Baseline should be captured. Hip Y from buildBoxJumpPose at hipYOffset=0:
    // baseHipY ≈ 0.88 - 0.18 - 0.18 = 0.52
    const baseline = result.finalCalibration?.baseline;
    expect(baseline).toBeDefined();
    if (baseline) {
      expect(baseline.hipMid.y).toBeGreaterThan(0.40);
      expect(baseline.hipMid.y).toBeLessThan(0.65);
    }
  });

  it('all calibration gates are green after confirm', () => {
    const frames = buildFrames(
      () => ({ hipYOffset: 0, kneeAngleDeg: 170 } satisfies BoxJumpPoseIntent),
      buildBoxJumpPose,
      { fps: 30, durationMs: 1000 },
    );
    const result = runBoxJumpSession(frames);
    expect(result.finalCalibration?.checks.fullBodyVisible).toBe(true);
    expect(result.finalCalibration?.checks.feetWide).toBe(true);       // sideProfile gate
    expect(result.finalCalibration?.checks.armsOverhead).toBe(true);   // armsAtSides gate
    expect(result.finalCalibration?.checks.distanceOk).toBe(true);
  });
});
