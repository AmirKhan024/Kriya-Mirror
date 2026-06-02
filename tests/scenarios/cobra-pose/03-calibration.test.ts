/**
 * Calibration tests:
 *   - 4 gates pass on a clean cobra (Fix G instant confirm ~200ms)
 *   - distanceHint='too-far' when the body span is below the floor (Fix X analog)
 *   - distanceHint='too-close' when the body span overflows the band
 *   - Shallow chest-lift fails the "chest lifted" gate (armsOverhead remap)
 *   - A standing pose fails the "prone" gate (feetWide remap)
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildCobraPosePose, buildChairPosePose } from '../../harness/pose-stub';
import { runCobraPoseSession } from '../../harness/runner';
import type { CobraPosePoseIntent, ChairPosePoseIntent } from '../../harness/types';

describe('Cobra Pose — calibration', () => {
  it('confirms within ~400ms once all gates are green (Fix G instant calibration)', () => {
    const frames = buildFrames(
      (): CobraPosePoseIntent => ({ elevationDeg: 28, side: 'left' }),
      buildCobraPosePose,
      { fps: 30, durationMs: 1500 },
    );
    const result = runCobraPoseSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThanOrEqual(400);
  });

  it('reports too-far when the body span is below the floor (Fix X analog)', () => {
    const frames = buildFrames(
      (): CobraPosePoseIntent => ({ elevationDeg: 28, bodyLengthX: 0.12, side: 'left' }),
      buildCobraPosePose,
      { fps: 30, durationMs: 1500 },
    );
    const result = runCobraPoseSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.distanceHint).toBe('too-far');
    expect(result.finalCalibration?.checks.distanceOk).toBe(false);
  });

  it('reports too-close when the body span overflows the band', () => {
    const frames = buildFrames(
      (): CobraPosePoseIntent => ({ elevationDeg: 28, bodyLengthX: 1.0, side: 'left' }),
      buildCobraPosePose,
      { fps: 30, durationMs: 1500 },
    );
    const result = runCobraPoseSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.distanceHint).toBe('too-close');
  });

  it('keeps the "chest lifted" gate red when the chest is barely raised', () => {
    const frames = buildFrames(
      (): CobraPosePoseIntent => ({ elevationDeg: 8, side: 'left' }),
      buildCobraPosePose,
      { fps: 30, durationMs: 1500 },
    );
    const result = runCobraPoseSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.checks.armsOverhead).toBe(false); // remap: chest lifted
  });

  it('keeps the "prone" gate red for a standing pose (legs vertical, not on the floor)', () => {
    // A standing chair-pose silhouette: hip→ankle is vertical, so the prone
    // (roughly-horizontal lower body) gate must reject it even though the
    // shoulder sits above the hip.
    const frames = buildFrames(
      (): ChairPosePoseIntent => ({ kneeFlexionDeg: 5, trunkLeanDeg: 0, side: 'left' }),
      buildChairPosePose,
      { fps: 30, durationMs: 1500 },
    );
    const result = runCobraPoseSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.checks.feetWide).toBe(false); // remap: prone
  });
});
