import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildDownwardDogPose } from '../../harness/pose-stub';
import { runDownwardDogSession } from '../../harness/runner';
import type { DownwardDogPoseIntent } from '../../harness/types';

const CAL_MS = 1000;

describe('Downward Dog — happy path', () => {
  it('calibrates quickly and holds for 20s with no warnings', () => {
    const frames = buildFrames(
      (): DownwardDogPoseIntent => ({ apexAngleDeg: 90, side: 'left' }),
      buildDownwardDogPose,
      { fps: 30, durationMs: CAL_MS + 20_000 },
    );
    const result = runDownwardDogSession(frames);
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
      (): DownwardDogPoseIntent => ({ apexAngleDeg: 95, side: 'right' }),
      buildDownwardDogPose,
      { fps: 30, durationMs: CAL_MS + 22_000 },
    );
    const result = runDownwardDogSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    const lastTick = result.holdTicks[result.holdTicks.length - 1];
    expect(lastTick.secondsElapsed).toBeGreaterThanOrEqual(20);
    expect(lastTick.longestUnfrozenSec).toBeGreaterThanOrEqual(20);
  });
});
