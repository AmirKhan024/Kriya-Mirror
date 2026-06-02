import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildGluteBridgePose } from '../../harness/pose-stub';
import { runGluteBridgeSession } from '../../harness/runner';
import { IDX } from '../../harness/types';
import type { GluteBridgePoseIntent } from '../../harness/types';

// CONFIRM_DURATION_MS=200 → confirms within ~400ms at 30fps
// Gates: fullBodyVisible, kneeBent (feetWide slot), hipsDown (armsOverhead slot), distanceOk

describe('Glute Bridge — calibration gates', () => {
  it('confirms within 400ms when all gates pass', () => {
    const frames = buildFrames(
      () => ({ hipRise: 0 } as GluteBridgePoseIntent),
      buildGluteBridgePose,
      { fps: 30, durationMs: 1000 },
    );
    const result = runGluteBridgeSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThanOrEqual(500);
  });

  it('fails kneeBent gate when knees are not raised above hip level', () => {
    // kneeBentOverride=true → knee Y is at/below hip Y, failing the kneeBent check.
    const frames = buildFrames(
      () => ({ hipRise: 0, kneeBentOverride: true } as GluteBridgePoseIntent),
      buildGluteBridgePose,
      { fps: 30, durationMs: 2000 },
    );
    const result = runGluteBridgeSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.checks.feetWide).toBe(false);
  });

  it('fails hipsDown gate when hips are already elevated at calibration', () => {
    // hipsUpAtRest=true → hips raised off floor, failing the hipsDown check.
    const frames = buildFrames(
      () => ({ hipRise: 0, hipsUpAtRest: true } as GluteBridgePoseIntent),
      buildGluteBridgePose,
      { fps: 30, durationMs: 2000 },
    );
    const result = runGluteBridgeSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.checks.armsOverhead).toBe(false);
  });

  it('fails fullBodyVisible gate when key landmarks are occluded', () => {
    const frames = buildFrames(
      () => ({
        hipRise: 0,
        occludedIndices: [IDX.leftAnkle],
      } as GluteBridgePoseIntent),
      buildGluteBridgePose,
      { fps: 30, durationMs: 2000 },
    );
    const result = runGluteBridgeSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.checks.fullBodyVisible).toBe(false);
  });
});
