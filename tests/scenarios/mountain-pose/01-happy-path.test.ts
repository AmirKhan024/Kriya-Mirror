import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildMountainPosePose } from '../../harness/pose-stub';
import { runMountainPoseSession, warningsOtherThan } from '../../harness/runner';
import type { MountainPosePoseIntent } from '../../harness/types';

const CAL_MS = 2200;

describe('Mountain Pose — happy path', () => {
  it('calibrates within 2.3s and holds for 30s with no warnings', () => {
    const frames = buildFrames(
      () => ({} as MountainPosePoseIntent),
      buildMountainPosePose,
      { fps: 30, durationMs: CAL_MS + 30_000 },
    );
    const result = runMountainPoseSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThanOrEqual(2300);
    expect(result.broken).toBe(false);
    expect(warningsOtherThan(result, 'not-moving').length).toBe(0);
    expect(result.holdTicks.length).toBeGreaterThanOrEqual(28);
    const avgMqs = result.holdTicks.reduce((s, t) => s + t.mqs, 0) / result.holdTicks.length;
    expect(avgMqs).toBeGreaterThanOrEqual(85);
  });

  it('reaches target 20s hold on clean form (slight default sway tolerated)', () => {
    const frames = buildFrames(
      () => ({} as MountainPosePoseIntent),
      buildMountainPosePose,
      { fps: 30, durationMs: CAL_MS + 22_000 },
    );
    const result = runMountainPoseSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    const lastTick = result.holdTicks[result.holdTicks.length - 1];
    expect(lastTick.secondsElapsed).toBeGreaterThanOrEqual(20);
  });
});
