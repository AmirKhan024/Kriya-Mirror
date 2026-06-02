/**
 * Calibration tests:
 *   - 4 gates pass on a clean Triangle Pose (Fix G instant confirm ~200 ms)
 *   - Narrow stance → fails feetWide
 *   - Bent legs at cal → fails the posture gate (mapped to armsOverhead slot)
 *   - Arms not in triangle position → fails posture gate
 *   - shoulderWidth below MIN_SHOULDER_WIDTH (0.08) → Fix X regression:
 *     calibration rejects with too-far hint
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildTrianglePosePose } from '../../harness/pose-stub';
import { runTrianglePoseSession } from '../../harness/runner';
import type { TrianglePosePoseIntent } from '../../harness/types';

describe('Triangle Pose — calibration', () => {
  it('confirms within ~400 ms when all 4 gates pass (Fix G instant)', () => {
    const frames = buildFrames(
      () => ({} as TrianglePosePoseIntent),
      buildTrianglePosePose,
      { fps: 30, durationMs: 1500 },
    );
    const result = runTrianglePoseSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThanOrEqual(400);
  });

  it('fails the stance gate when feet are too close together', () => {
    const frames = buildFrames(
      () => ({ stanceWidth: 0.10 } as TrianglePosePoseIntent),
      buildTrianglePosePose,
      { fps: 30, durationMs: 1500 },
    );
    const result = runTrianglePoseSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.checks.feetWide).toBe(false);
  });

  it('fails the posture gate when both knees are bent at cal', () => {
    const frames = buildFrames(
      () => ({ frontKneeFlexionDeg: 45, backKneeFlexionDeg: 45 } as TrianglePosePoseIntent),
      buildTrianglePosePose,
      { fps: 30, durationMs: 1500 },
    );
    const result = runTrianglePoseSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    // Bent knees cause the "wide stance + legs straight" composite gate to
    // fail, which is mapped to the feetWide slot.
    expect(result.finalCalibration?.checks.feetWide).toBe(false);
  });

  it('fails the posture gate when arms are at the chest (no triangle)', () => {
    const frames = buildFrames(
      () => ({ armsAtChest: true } as TrianglePosePoseIntent),
      buildTrianglePosePose,
      { fps: 30, durationMs: 1500 },
    );
    const result = runTrianglePoseSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.checks.armsOverhead).toBe(false);
  });

  it('reports too-far when shoulder width is below MIN_SHOULDER_WIDTH (Fix X)', () => {
    const frames = buildFrames(
      () => ({ shoulderWidthOverride: 0.05 } as TrianglePosePoseIntent),
      buildTrianglePosePose,
      { fps: 30, durationMs: 1500 },
    );
    const result = runTrianglePoseSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.distanceHint).toBe('too-far');
    expect(result.finalCalibration?.checks.distanceOk).toBe(false);
  });
});
