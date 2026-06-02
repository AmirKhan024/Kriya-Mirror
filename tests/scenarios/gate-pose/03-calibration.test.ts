/**
 * Calibration gates:
 *   - 4 gates pass on a clean gate pose (Fix G instant confirm)
 *   - Not bent enough → fails the bend (armsOverhead) gate
 *   - Top arm down → fails the bend (armsOverhead) gate
 *   - Narrow stance → fails the wideStance (feetWide) gate
 *   - Narrow shoulderWidth (Fix X) → reject as too-far
 *   - Occluded landmark → fails fullBodyVisible
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildGatePosePose } from '../../harness/pose-stub';
import { runGatePoseSession } from '../../harness/runner';
import { IDX } from '../../harness/types';
import type { GatePosePoseIntent } from '../../harness/types';

describe('Gate Pose — calibration', () => {
  it('confirms within ~400ms when all gates pass (Fix G instant)', () => {
    const frames = buildFrames(
      () => ({ bendSide: 'right' as const } as GatePosePoseIntent),
      buildGatePosePose,
      { fps: 30, durationMs: 1500 },
    );
    const result = runGatePoseSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThanOrEqual(400);
  });

  it('fails the bend gate when the torso is barely bent', () => {
    const frames = buildFrames(
      () => ({ bendSide: 'right' as const, leanDeg: 5 } as GatePosePoseIntent),
      buildGatePosePose,
      { fps: 30, durationMs: 1500 },
    );
    const result = runGatePoseSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.checks.armsOverhead).toBe(false);
  });

  it('fails the bend gate when the top arm is not raised', () => {
    const frames = buildFrames(
      () => ({ bendSide: 'right' as const, topArmUp: false } as GatePosePoseIntent),
      buildGatePosePose,
      { fps: 30, durationMs: 1500 },
    );
    const result = runGatePoseSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.checks.armsOverhead).toBe(false);
  });

  it('fails the wideStance gate when the leg is not extended out', () => {
    const frames = buildFrames(
      () => ({ bendSide: 'right' as const, legSpread: 0.03 } as GatePosePoseIntent),
      buildGatePosePose,
      { fps: 30, durationMs: 1500 },
    );
    const result = runGatePoseSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.checks.feetWide).toBe(false);
  });

  it('rejects a too-far pose (small body height) as too-far', () => {
    // Distance now keys on body height (robust to the side-bend), not shoulderWidth.
    const frames = buildFrames(
      () => ({ bendSide: 'right' as const, bodyHeight: 0.35 } as GatePosePoseIntent),
      buildGatePosePose,
      { fps: 30, durationMs: 1500 },
    );
    const result = runGatePoseSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.distanceHint).toBe('too-far');
    expect(result.finalCalibration?.checks.distanceOk).toBe(false);
  });

  it('still confirms at a good distance with a DEEPER lean (distance is decoupled from the bend)', () => {
    // The owner bug: bending to satisfy the bend gate used to break the distance
    // gate (shoulderWidth foreshortened). With body-height distance it must NOT.
    const frames = buildFrames(
      () => ({ bendSide: 'right' as const, leanDeg: 35 } as GatePosePoseIntent),
      buildGatePosePose,
      { fps: 30, durationMs: 1500 },
    );
    const result = runGatePoseSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.finalCalibration?.checks.distanceOk).toBe(true);
  });

  it('fails when key landmarks are occluded (fullBodyVisible gate)', () => {
    const frames = buildFrames(
      () => ({ bendSide: 'right' as const, occludedIndices: [IDX.leftWrist] } as GatePosePoseIntent),
      buildGatePosePose,
      { fps: 30, durationMs: 1500 },
    );
    const result = runGatePoseSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.checks.fullBodyVisible).toBe(false);
  });
});
