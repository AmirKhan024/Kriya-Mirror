import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildForwardFoldPose } from '../../harness/pose-stub';
import { runStandingForwardFoldSession } from '../../harness/runner';
import type { ForwardFoldPoseIntent } from '../../harness/types';

const CAL_MS = 1000;

describe('Standing Forward Fold — happy path', () => {
  it('calibrates quickly and holds for 30s with no warnings', () => {
    const frames = buildFrames(
      () => ({ foldAngleDeg: 75, kneeFlexionDeg: 5, side: 'left' as const } as ForwardFoldPoseIntent),
      buildForwardFoldPose,
      { fps: 30, durationMs: CAL_MS + 30_000 },
    );
    const result = runStandingForwardFoldSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThanOrEqual(600);
    expect(result.broken).toBe(false);
    expect(result.warnings.length).toBe(0);
    expect(result.holdTicks.length).toBeGreaterThanOrEqual(28);
    const avgMqs = result.holdTicks.reduce((s, t) => s + t.mqs, 0) / result.holdTicks.length;
    expect(avgMqs).toBeGreaterThanOrEqual(90);
  });

  it('accumulates valid hold time and tracks the longest unfrozen streak', () => {
    const frames = buildFrames(
      () => ({ foldAngleDeg: 80, kneeFlexionDeg: 4, side: 'right' as const } as ForwardFoldPoseIntent),
      buildForwardFoldPose,
      { fps: 30, durationMs: CAL_MS + 22_000 },
    );
    const result = runStandingForwardFoldSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    const lastTick = result.holdTicks[result.holdTicks.length - 1];
    expect(lastTick.secondsElapsed).toBeGreaterThanOrEqual(20);
    expect(lastTick.longestUnfrozenSec).toBeGreaterThanOrEqual(20);
  });
});
