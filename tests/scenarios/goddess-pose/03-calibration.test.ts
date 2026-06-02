/**
 * Calibration tests:
 *   - 4 gates pass on a clean Goddess Pose (Fix G instant confirm ~200 ms)
 *   - Narrow stance → fails feetWide gate
 *   - Both knees straight → fails feetWide gate (the gate is "wide stance +
 *     both knees bent" — straight knees with wide feet still fails)
 *   - Arms relaxed at sides → fails armsOverhead (cactus) gate
 *   - shoulderWidth below MIN_SHOULDER_WIDTH (0.08) → Fix X regression:
 *     calibration rejects with too-far hint
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildGoddessPosePose } from '../../harness/pose-stub';
import { runGoddessPoseSession } from '../../harness/runner';
import type { GoddessPosePoseIntent } from '../../harness/types';

describe('Goddess Pose — calibration', () => {
  it('confirms within ~400 ms when all 4 gates pass (Fix G instant)', () => {
    const frames = buildFrames(
      () => ({ kneeFlexionDeg: 90 } as GoddessPosePoseIntent),
      buildGoddessPosePose,
      { fps: 30, durationMs: 1500 },
    );
    const result = runGoddessPoseSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThanOrEqual(400);
  });

  it('fails the wide-stance gate when feet are too close together', () => {
    const frames = buildFrames(
      () => ({ kneeFlexionDeg: 90, stanceWidth: 0.12 } as GoddessPosePoseIntent),
      buildGoddessPosePose,
      { fps: 30, durationMs: 1500 },
    );
    const result = runGoddessPoseSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.checks.feetWide).toBe(false);
  });

  it('fails the wide-stance gate when both knees are straight (not in the pose)', () => {
    // Wide stance but no knee bend — user isn't in the pose yet.
    const frames = buildFrames(
      () => ({ kneeFlexionDeg: 5 } as GoddessPosePoseIntent),
      buildGoddessPosePose,
      { fps: 30, durationMs: 1500 },
    );
    const result = runGoddessPoseSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.checks.feetWide).toBe(false);
  });

  it('fails the cactus-arms gate when arms hang at the sides', () => {
    const frames = buildFrames(
      () => ({ kneeFlexionDeg: 90, armsAtSides: true } as GoddessPosePoseIntent),
      buildGoddessPosePose,
      { fps: 30, durationMs: 1500 },
    );
    const result = runGoddessPoseSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.checks.armsOverhead).toBe(false);
  });

  it('reports too-far when shoulderWidth is below MIN_SHOULDER_WIDTH (Fix X)', () => {
    // Forcing shoulderWidth = 0.05 (below the 0.08 floor) should reject the
    // baseline AND surface a 'too-far' hint — defense against degenerate
    // baselines that would collapse every distance-normalized check.
    const frames = buildFrames(
      () => ({
        kneeFlexionDeg: 90,
        shoulderWidthOverride: 0.05,
      } as GoddessPosePoseIntent),
      buildGoddessPosePose,
      { fps: 30, durationMs: 1500 },
    );
    const result = runGoddessPoseSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.distanceHint).toBe('too-far');
    expect(result.finalCalibration?.checks.distanceOk).toBe(false);
  });
});
