import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildSidePlankPose } from '../../harness/pose-stub';
import { runSidePlankSession, warningsOtherThan } from '../../harness/runner';
import type { SidePlankPoseIntent } from '../../harness/types';

const CAL_MS = 2200;

describe('Side Plank — happy path', () => {
  it('calibrates instantly and holds a straight side plank with no warnings', () => {
    const frames = buildFrames(
      () => ({ hipDelta: 0 } as SidePlankPoseIntent),
      buildSidePlankPose,
      { fps: 30, durationMs: CAL_MS + 16_000 },
    );
    const result = runSidePlankSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThanOrEqual(2300);
    expect(result.broken).toBe(false);
    expect(warningsOtherThan(result, 'not-moving').length).toBe(0);
    expect(result.holdTicks.length).toBeGreaterThanOrEqual(13);
    const avgMqs = result.holdTicks.reduce((s, t) => s + t.mqs, 0) / result.holdTicks.length;
    expect(avgMqs).toBeGreaterThanOrEqual(85);
  });

  it('reaches a 12s hold on clean form (shorter body / further away)', () => {
    const frames = buildFrames(
      () => ({ hipDelta: 0, bodyLengthX: 0.5 } as SidePlankPoseIntent),
      buildSidePlankPose,
      { fps: 30, durationMs: CAL_MS + 14_000 },
    );
    const result = runSidePlankSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    const lastTick = result.holdTicks[result.holdTicks.length - 1];
    expect(lastTick.secondsElapsed).toBeGreaterThanOrEqual(12);
  });
});
