/**
 * Calibration (reuses LungeCalibration):
 *   - 4 gates pass on a clean upright pose (Fix G instant confirm)
 *   - Feet too wide fails the feetTogether gate (feetWide slot)
 *   - Arms raised fails the armsAtSides gate (armsOverhead slot)
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildLungePose } from '../../harness/pose-stub';
import { runReverseLungeSession } from '../../harness/runner';
import type { LungePoseIntent } from '../../harness/types';

describe('Reverse Lunge — calibration', () => {
  it('confirms within ~400ms of all gates green', () => {
    const frames = buildFrames(
      () => ({ kneeFlexionDeg: 0, frontLeg: 'left', armsAtSides: true } as LungePoseIntent),
      buildLungePose,
      { fps: 30, durationMs: 1500 },
    );
    const result = runReverseLungeSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThanOrEqual(400);
  });

  it('keeps the feetTogether gate red when the feet are too wide', () => {
    const frames = buildFrames(
      () => ({ kneeFlexionDeg: 0, frontLeg: 'left', armsAtSides: true, feetWidthRatio: 1.6 } as LungePoseIntent),
      buildLungePose,
      { fps: 30, durationMs: 1500 },
    );
    const result = runReverseLungeSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.checks.feetWide).toBe(false); // remap: feetTogether
  });

  it('keeps the armsAtSides gate red when the arms are raised', () => {
    const frames = buildFrames(
      () => ({ kneeFlexionDeg: 0, frontLeg: 'left', armsAtSides: false } as LungePoseIntent),
      buildLungePose,
      { fps: 30, durationMs: 1500 },
    );
    const result = runReverseLungeSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.checks.armsOverhead).toBe(false); // remap: armsAtSides
  });
});
