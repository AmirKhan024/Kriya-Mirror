/**
 * Star Jump — calibration.
 * - Arms-at-sides gate passes for standard pose.
 * - Arms raised (armRaiseDeg=90) fails armsAtSides gate and delays calibration.
 * - Feet spread wide (feetSpreadRatio=1.8) fails feetAtSides gate.
 * - Instant confirm (200ms).
 * - Timeout at 20s.
 *
 * Pose geometry:
 *   shoulderMidY = 0.34, ankleY = 0.92
 *   bodyHeight = |0.92 - 0.34| = 0.58  → in [ENTER_MIN=0.48, ENTER_MAX=0.89] → distanceOk passes.
 *   armRaiseDeg=0: wristMidY = 0.34 + 0.26 = 0.60. 0.60 > 0.34 + 0.08 → armsAtSides passes.
 *   armRaiseDeg=90: wristMidY = 0.34 + 0 = 0.34. NOT > 0.42 → armsAtSides FAILS.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildStarJumpPose } from '../../harness/pose-stub';
import { runStarJumpSession } from '../../harness/runner';

describe('Star Jump — calibration', () => {
  it('calibrates quickly with arms at sides and feet together', () => {
    const frames = buildFrames(
      () => ({ armRaiseDeg: 0, feetSpreadRatio: 1.0 }),
      buildStarJumpPose,
      { fps: 30, durationMs: 600 },
    );

    const result = runStarJumpSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThan(500);
  });

  it('arms at T-pose (armRaiseDeg=90) fails armsAtSides gate and blocks calibration', () => {
    // wristMidY = shoulderMidY + 0 = shoulderMidY. NOT > shoulderMidY + 0.08 → gate fails.
    const frames = buildFrames(
      () => ({ armRaiseDeg: 90, feetSpreadRatio: 1.0 }),
      buildStarJumpPose,
      { fps: 30, durationMs: 600 },
    );

    const result = runStarJumpSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
  });

  it('arms overhead (armRaiseDeg=170) fails armsAtSides gate and blocks calibration', () => {
    // wristMidY = shoulderMidY - 0.256 = well above shoulder. NOT > shoulderMidY + 0.08 → gate fails.
    const frames = buildFrames(
      () => ({ armRaiseDeg: 170, feetSpreadRatio: 1.0 }),
      buildStarJumpPose,
      { fps: 30, durationMs: 600 },
    );

    const result = runStarJumpSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
  });

  it('feet spread wide (feetSpreadRatio=1.8) fails feetAtSides gate and blocks calibration', () => {
    // ankleWidth = shoulderWidth * 1.8 > MAX_FEET_RATIO(1.20) * shoulderWidth → feetAtSides FAILS.
    const frames = buildFrames(
      () => ({ armRaiseDeg: 0, feetSpreadRatio: 1.8 }),
      buildStarJumpPose,
      { fps: 30, durationMs: 600 },
    );

    const result = runStarJumpSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
  });

  it('times out after 20s with no valid pose (null frames)', () => {
    const frames = buildFrames(
      () => null,
      buildStarJumpPose,
      { fps: 30, durationMs: 21_000 },
    );

    const result = runStarJumpSession(frames);
    expect(result.finalCalibration?.state).toBe('timeout');
    expect(result.calibrationConfirmedAtMs).toBeNull();
  });
});
