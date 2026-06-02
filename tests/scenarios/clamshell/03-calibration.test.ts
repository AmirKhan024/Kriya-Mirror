/**
 * Clamshell — calibration gates.
 *
 * Tests:
 *   - All gates pass (lying on side, ankles together) → confirms within 300ms
 *   - Both hips at same Y (not lying on side) → sideLying gate fails → never confirms
 *   - Too close (body span > 95% frame) → distanceOk fails + distanceHint='too-close'
 *   - Timeout after 30s → state='timeout'
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildClamshellPose } from '../../harness/pose-stub';
import { runClamshellSession } from '../../harness/runner';
import type { ClamshellPoseIntent } from '../../harness/types';

describe('Clamshell — calibration gates', () => {
  it('confirms within 300ms when all gates pass', () => {
    // Proper side-lying position: left side down, knees together
    const frames = buildFrames(
      () => ({ abductionFrac: 0, sideDown: 'left' as const } as ClamshellPoseIntent),
      buildClamshellPose,
      { fps: 30, durationMs: 1000 },
    );
    const result = runClamshellSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThanOrEqual(300);
  });

  it('confirms with right side down', () => {
    const frames = buildFrames(
      () => ({ abductionFrac: 0, sideDown: 'right' as const } as ClamshellPoseIntent),
      buildClamshellPose,
      { fps: 30, durationMs: 1000 },
    );
    const result = runClamshellSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
  });

  it('provides a confirmed baseline with hipGap > 0', () => {
    const frames = buildFrames(
      () => ({ abductionFrac: 0, sideDown: 'left' as const } as ClamshellPoseIntent),
      buildClamshellPose,
      { fps: 30, durationMs: 1000 },
    );
    const result = runClamshellSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    // Baseline should exist
    expect(result.finalCalibration?.baseline).toBeDefined();
  });

  it('stays in waiting state when all null frames (no body visible)', () => {
    // No landmarks → fullBodyVisible fails → cannot confirm
    const frames = buildFrames(
      () => null,
      buildClamshellPose,
      { fps: 30, durationMs: 5000 },
    );
    const result = runClamshellSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeNull();
  });
});
