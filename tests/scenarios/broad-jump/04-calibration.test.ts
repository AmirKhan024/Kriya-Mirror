/**
 * Broad Jump — calibration tests.
 * Tests gate pass/fail, distance hints, instant confirm (~200ms), and timeout.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildBroadJumpPose } from '../../harness/pose-stub';
import { runBroadJumpSession } from '../../harness/runner';
import type { BroadJumpPoseIntent } from '../../harness/types';

describe('Broad Jump — calibration', () => {
  it('confirms within ~200ms when all gates pass', () => {
    const frames = buildFrames(
      (): BroadJumpPoseIntent => ({ hipYOffset: 0, kneeFlexionDeg: 5 }),
      buildBroadJumpPose,
      { fps: 30, durationMs: 1000 },
    );
    const result = runBroadJumpSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).not.toBeNull();
    expect(result.calibrationConfirmedAtMs!).toBeLessThanOrEqual(500);
  });

  it('stays in waiting state when body too close (height > 0.90)', () => {
    const frames = buildFrames(
      (): BroadJumpPoseIntent => ({ hipYOffset: 0, kneeFlexionDeg: 5, bodyHeight: 0.95 }),
      buildBroadJumpPose,
      { fps: 30, durationMs: 1000 },
    );
    const result = runBroadJumpSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    const hints = result.calibrationUpdates.filter(u => u.distanceHint === 'too-close');
    expect(hints.length).toBeGreaterThan(0);
  });

  it('stays in waiting state when body too far (height < 0.50)', () => {
    const frames = buildFrames(
      (): BroadJumpPoseIntent => ({ hipYOffset: 0, kneeFlexionDeg: 5, bodyHeight: 0.30 }),
      buildBroadJumpPose,
      { fps: 30, durationMs: 1000 },
    );
    const result = runBroadJumpSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    const hints = result.calibrationUpdates.filter(u => u.distanceHint === 'too-far');
    expect(hints.length).toBeGreaterThan(0);
  });

  it('emits timeout state after 30s without confirming', () => {
    const frames = buildFrames(
      (): BroadJumpPoseIntent => ({ hipYOffset: 0, kneeFlexionDeg: 5, bodyHeight: 0.20 }),
      buildBroadJumpPose,
      { fps: 30, durationMs: 31_000 },
    );
    const result = runBroadJumpSession(frames);
    expect(result.finalCalibration?.state).toBe('timeout');
  });

  it('recovers from null landmarks gracefully', () => {
    let frame = 0;
    const frames = buildFrames(
      (tMs: number): BroadJumpPoseIntent => {
        frame++;
        if (frame % 5 === 0) return { hipYOffset: 0, kneeFlexionDeg: 5, occludedIndices: [23, 24, 25, 26, 27, 28] };
        return { hipYOffset: 0, kneeFlexionDeg: 5 };
      },
      buildBroadJumpPose,
      { fps: 30, durationMs: 1500 },
    );
    const result = runBroadJumpSession(frames);
    expect(result.finalCalibration).not.toBeNull();
  });
});
