import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildStarPosePose } from '../../harness/pose-stub';
import { runStarPoseSession, warningsOtherThan } from '../../harness/runner';

const CAL_MS = 2200;

describe('Star Pose — happy path', () => {
  it('calibrates within 2.2s and holds 20s with no warnings (left leg extended)', () => {
    const frames = buildFrames(
      () => ({ liftedSide: 'left' as const }),
      buildStarPosePose,
      { fps: 30, durationMs: CAL_MS + 20_000 },
    );
    const result = runStarPoseSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThanOrEqual(2300);
    expect(result.broken).toBe(false);
    expect(warningsOtherThan(result).length).toBe(0);
    expect(result.holdTicks.length).toBeGreaterThanOrEqual(17);
    const avgMqs = result.holdTicks.reduce((s, t) => s + t.mqs, 0) / result.holdTicks.length;
    expect(avgMqs).toBeGreaterThanOrEqual(85);
  });

  it('also works with the right leg extended', () => {
    const frames = buildFrames(
      () => ({ liftedSide: 'right' as const }),
      buildStarPosePose,
      { fps: 30, durationMs: CAL_MS + 10_000 },
    );
    const result = runStarPoseSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.broken).toBe(false);
    expect(warningsOtherThan(result).length).toBe(0);
  });
});
