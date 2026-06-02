/**
 * Regression test for the round-6 cross-cutting `position-lost` warning,
 * now wired into Single-Leg Stand. Mirrors the lunge and tandem-stand
 * position-lost tests exactly.
 *
 * Spec: if no usable pose frame (landmarks null OR core body landmarks
 * not visible) for ≥ 3 seconds post-calibration, the engine emits
 * `position-lost`. Repeats at most every 10s while still lost.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildSingleLegStandPose } from '../../harness/pose-stub';
import { runSingleLegStandSession, countWarnings } from '../../harness/runner';
import type { SingleLegStandPoseIntent } from '../../harness/types';

const CAL_MS = 2200;

describe('Single Leg Stand — position-lost warning (round 6)', () => {
  it('fires position-lost after 3+ seconds of null landmarks post-calibration', () => {
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) {
          return { liftedSide: 'left' as const } as SingleLegStandPoseIntent;
        }
        return null;
      },
      buildSingleLegStandPose,
      { fps: 30, durationMs: CAL_MS + 4000 },
    );

    const result = runSingleLegStandSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'position-lost')).toBeGreaterThan(0);
  });

  it('does NOT fire position-lost on a clean continuous stream', () => {
    const frames = buildFrames(
      () => ({ liftedSide: 'left' as const } as SingleLegStandPoseIntent),
      buildSingleLegStandPose,
      { fps: 30, durationMs: 4000 },
    );

    const result = runSingleLegStandSession(frames);
    expect(countWarnings(result, 'position-lost')).toBe(0);
  });

  it('does NOT fire position-lost during the brief calibration phase', () => {
    const frames = buildFrames(
      (tMs) => {
        if (tMs < 1500) return null;
        return { liftedSide: 'left' as const } as SingleLegStandPoseIntent;
      },
      buildSingleLegStandPose,
      { fps: 30, durationMs: 3000 },
    );

    const result = runSingleLegStandSession(frames);
    expect(countWarnings(result, 'position-lost')).toBe(0);
  });

  it('does NOT re-fire position-lost within the 10s cooldown', () => {
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) {
          return { liftedSide: 'left' as const } as SingleLegStandPoseIntent;
        }
        return null;
      },
      buildSingleLegStandPose,
      { fps: 30, durationMs: CAL_MS + 5000 },
    );

    const result = runSingleLegStandSession(frames);
    expect(countWarnings(result, 'position-lost')).toBe(1);
  });
});
