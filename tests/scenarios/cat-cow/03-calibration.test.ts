/**
 * Calibration (side-on, on all fours, spine neutral):
 *   - 4 gates pass on a clean neutral quadruped (Fix G instant confirm)
 *   - Head already arched/rounded → fails the head-neutral (armsOverhead) gate
 *   - Back not level (torso steep) → fails the back-level (feetWide) gate
 *   - Tiny body span → too-far (Fix X analog)
 *   - Occluded landmark → fails fullBodyVisible
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildCatCowPose } from '../../harness/pose-stub';
import { runCatCowSession } from '../../harness/runner';
import { IDX } from '../../harness/types';
import type { CatCowPoseIntent } from '../../harness/types';

describe('Cat-Cow — calibration', () => {
  it('confirms within ~400ms of all gates green (Fix G instant calibration)', () => {
    const frames = buildFrames(
      () => ({ neckPitchDeg: 0 } as CatCowPoseIntent),
      buildCatCowPose,
      { fps: 30, durationMs: 1500 },
    );
    const result = runCatCowSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThanOrEqual(400);
  });

  it('fails the head-neutral gate when the head is already arched at cal', () => {
    const frames = buildFrames(
      () => ({ neckPitchDeg: 30 } as CatCowPoseIntent),
      buildCatCowPose,
      { fps: 30, durationMs: 1500 },
    );
    const result = runCatCowSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.checks.armsOverhead).toBe(false); // remap: head neutral
  });

  it('fails the back-level gate when the torso is not horizontal', () => {
    const frames = buildFrames(
      () => ({ neckPitchDeg: 0, backTiltDeg: 60 } as CatCowPoseIntent),
      buildCatCowPose,
      { fps: 30, durationMs: 1500 },
    );
    const result = runCatCowSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.checks.feetWide).toBe(false); // remap: back level
  });

  it('reports distanceHint=too-far when the body span is tiny (Fix X analog)', () => {
    const frames = buildFrames(
      () => ({ neckPitchDeg: 0, bodyLengthX: 0.18 } as CatCowPoseIntent),
      buildCatCowPose,
      { fps: 30, durationMs: 1500 },
    );
    const result = runCatCowSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.distanceHint).toBe('too-far');
    expect(result.finalCalibration?.checks.distanceOk).toBe(false);
  });

  it('fails when key landmarks are occluded (fullBodyVisible gate)', () => {
    const frames = buildFrames(
      () => ({ neckPitchDeg: 0, occludedIndices: [IDX.nose] } as CatCowPoseIntent),
      buildCatCowPose,
      { fps: 30, durationMs: 1500 },
    );
    const result = runCatCowSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.checks.fullBodyVisible).toBe(false);
  });
});
