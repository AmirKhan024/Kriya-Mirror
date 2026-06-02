import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildTreePosePose } from '../../harness/pose-stub';
import { runTreePoseSession, warningsOtherThan } from '../../harness/runner';
import type { TreePosePoseIntent } from '../../harness/types';

const CAL_MS = 2200;

describe('Tree Pose — happy path', () => {
  it('calibrates within 2.3s and holds for 30s with no warnings', () => {
    const frames = buildFrames(
      () => ({ liftedSide: 'left' as const, wrists: 'chest' as const } as TreePosePoseIntent),
      buildTreePosePose,
      { fps: 30, durationMs: CAL_MS + 30_000 },
    );
    const result = runTreePoseSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThanOrEqual(2300);
    expect(result.broken).toBe(false);
    expect(warningsOtherThan(result, 'not-moving').length).toBe(0);
    expect(result.holdTicks.length).toBeGreaterThanOrEqual(28);
    const avgMqs = result.holdTicks.reduce((s, t) => s + t.mqs, 0) / result.holdTicks.length;
    expect(avgMqs).toBeGreaterThanOrEqual(85);
  });

  it('reaches target hold of 20s when user holds clean form', () => {
    const frames = buildFrames(
      () => ({ liftedSide: 'right' as const, wrists: 'overhead' as const } as TreePosePoseIntent),
      buildTreePosePose,
      { fps: 30, durationMs: CAL_MS + 22_000 },
    );
    const result = runTreePoseSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    const lastTick = result.holdTicks[result.holdTicks.length - 1];
    expect(lastTick.secondsElapsed).toBeGreaterThanOrEqual(20);
  });
});
