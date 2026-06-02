import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildWallSitPose } from '../../harness/pose-stub';
import { runWallSitSession, warningsOtherThan } from '../../harness/runner';
import type { WallSitPoseIntent } from '../../harness/types';

const CAL_MS = 2200;

describe('Wall Sit — happy path', () => {
  it('calibrates within 2.3s and holds for 30s with no warnings', () => {
    const frames = buildFrames(
      () => ({ kneeFlexionDeg: 90, trunkLeanDeg: 4, side: 'left' as const } as WallSitPoseIntent),
      buildWallSitPose,
      { fps: 30, durationMs: CAL_MS + 30_000 },
    );
    const result = runWallSitSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThanOrEqual(2300);
    expect(result.broken).toBe(false);
    // No structural form warnings (knee-too-straight, torso-too-forward, heel-lift)
    expect(warningsOtherThan(result, 'not-moving').length).toBe(0);
    expect(result.holdTicks.length).toBeGreaterThanOrEqual(28);
    const avgMqs = result.holdTicks.reduce((s, t) => s + t.mqs, 0) / result.holdTicks.length;
    expect(avgMqs).toBeGreaterThanOrEqual(85);
  });

  it('reaches target hold in ~20s of valid time when the user holds clean form', () => {
    const frames = buildFrames(
      () => ({ kneeFlexionDeg: 95, trunkLeanDeg: 6, side: 'left' as const } as WallSitPoseIntent),
      buildWallSitPose,
      { fps: 30, durationMs: CAL_MS + 22_000 },
    );
    const result = runWallSitSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    const lastTick = result.holdTicks[result.holdTicks.length - 1];
    expect(lastTick.secondsElapsed).toBeGreaterThanOrEqual(20);
  });
});
