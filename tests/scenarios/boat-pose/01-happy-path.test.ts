import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildBoatPosePose } from '../../harness/pose-stub';
import { runBoatPoseSession, warningsOtherThan } from '../../harness/runner';
import type { BoatPosePoseIntent } from '../../harness/types';

const CAL_MS = 2200;

describe('Boat Pose — happy path', () => {
  it('calibrates instantly and holds the V with no warnings', () => {
    const frames = buildFrames(
      () => ({ torsoAngleDeg: 45, legAngleDeg: 40 } as BoatPosePoseIntent),
      buildBoatPosePose,
      { fps: 30, durationMs: CAL_MS + 16_000 },
    );
    const result = runBoatPoseSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThanOrEqual(2300);
    expect(result.broken).toBe(false);
    expect(warningsOtherThan(result, 'not-moving').length).toBe(0);
    expect(result.holdTicks.length).toBeGreaterThanOrEqual(13);
    const avgMqs = result.holdTicks.reduce((s, t) => s + t.mqs, 0) / result.holdTicks.length;
    expect(avgMqs).toBeGreaterThanOrEqual(85);
  });

  it('reaches a 12s hold on a clean V (lower-but-valid angles)', () => {
    const frames = buildFrames(
      () => ({ torsoAngleDeg: 35, legAngleDeg: 30 } as BoatPosePoseIntent),
      buildBoatPosePose,
      { fps: 30, durationMs: CAL_MS + 14_000 },
    );
    const result = runBoatPoseSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    const lastTick = result.holdTicks[result.holdTicks.length - 1];
    expect(lastTick.secondsElapsed).toBeGreaterThanOrEqual(12);
  });
});
