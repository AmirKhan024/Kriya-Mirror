import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildSeatedForwardFoldPose } from '../../harness/pose-stub';
import { runSeatedForwardFoldSession } from '../../harness/runner';
import type { SeatedForwardFoldPoseIntent } from '../../harness/types';

const CAL_MS = 1000;

describe('Seated Forward Fold — happy path', () => {
  it('calibrates quickly and holds for 20s with no warnings', () => {
    const frames = buildFrames(
      (): SeatedForwardFoldPoseIntent => ({ foldAngleDeg: 65, side: 'left' }),
      buildSeatedForwardFoldPose,
      { fps: 30, durationMs: CAL_MS + 20_000 },
    );
    const result = runSeatedForwardFoldSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThanOrEqual(600);
    expect(result.broken).toBe(false);
    expect(result.warnings.length).toBe(0);
    expect(result.holdTicks.length).toBeGreaterThanOrEqual(18);
    const avgMqs = result.holdTicks.reduce((s, t) => s + t.mqs, 0) / result.holdTicks.length;
    expect(avgMqs).toBeGreaterThanOrEqual(90);
  });

  it('accumulates valid hold time and tracks the longest unfrozen streak', () => {
    const frames = buildFrames(
      (): SeatedForwardFoldPoseIntent => ({ foldAngleDeg: 70, side: 'right' }),
      buildSeatedForwardFoldPose,
      { fps: 30, durationMs: CAL_MS + 22_000 },
    );
    const result = runSeatedForwardFoldSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    const lastTick = result.holdTicks[result.holdTicks.length - 1];
    expect(lastTick.secondsElapsed).toBeGreaterThanOrEqual(20);
    expect(lastTick.longestUnfrozenSec).toBeGreaterThanOrEqual(20);
  });

  // 2026-06-02 physical-test fix (round 2): a SLIGHT ~22° "fingers-to-toes" fold
  // (the owner's real comfortable depth) must both calibrate and accumulate.
  it('calibrates and accumulates on a slight ~22° toe-touch fold', () => {
    const frames = buildFrames(
      (): SeatedForwardFoldPoseIntent => ({ foldAngleDeg: 22, side: 'left' }),
      buildSeatedForwardFoldPose,
      { fps: 30, durationMs: CAL_MS + 10_000 },
    );
    const result = runSeatedForwardFoldSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.broken).toBe(false);
    expect(result.warnings.length).toBe(0);
    const lastTick = result.holdTicks[result.holdTicks.length - 1];
    expect(lastTick.secondsElapsed).toBeGreaterThanOrEqual(8);
  });
});
