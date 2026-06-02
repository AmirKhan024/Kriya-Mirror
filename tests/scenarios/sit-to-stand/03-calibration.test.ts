/**
 * Calibration tests:
 *   - 4 gates pass on a clean seated pose (Fix G instant confirm)
 *   - distanceHint=too-far when bodyHeight is below the floor (Fix X analog)
 *   - Standing (knees straight) fails the seated gate (feetWide slot)
 *   - Slumped torso fails the torsoUpright gate (armsOverhead slot)
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildChairPosePose } from '../../harness/pose-stub';
import { runSitToStandSession } from '../../harness/runner';
import type { ChairPosePoseIntent } from '../../harness/types';

describe('Sit-to-Stand — calibration', () => {
  it('confirms within ~400ms when seated cleanly', () => {
    const frames = buildFrames(
      () => ({ kneeFlexionDeg: 90, side: 'left' } as ChairPosePoseIntent),
      buildChairPosePose,
      { fps: 30, durationMs: 1500 },
    );
    const result = runSitToStandSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThanOrEqual(400);
  });

  it('reports distanceHint=too-far when bodyHeight is below the floor (Fix X analog)', () => {
    const frames = buildFrames(
      () => ({ kneeFlexionDeg: 90, bodyHeight: 0.20, side: 'left' } as ChairPosePoseIntent),
      buildChairPosePose,
      { fps: 30, durationMs: 1500 },
    );
    const result = runSitToStandSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.distanceHint).toBe('too-far');
  });

  it('keeps the seated gate red when the user is standing (knees straight)', () => {
    const frames = buildFrames(
      () => ({ kneeFlexionDeg: 5, side: 'left' } as ChairPosePoseIntent),
      buildChairPosePose,
      { fps: 30, durationMs: 1500 },
    );
    const result = runSitToStandSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.checks.feetWide).toBe(false); // remap: seated
  });

  it('keeps the torsoUpright gate red when slumped forward', () => {
    const frames = buildFrames(
      () => ({ kneeFlexionDeg: 90, trunkLeanDeg: 60, side: 'left' } as ChairPosePoseIntent),
      buildChairPosePose,
      { fps: 30, durationMs: 1500 },
    );
    const result = runSitToStandSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.checks.armsOverhead).toBe(false); // remap: torsoUpright
  });
});
