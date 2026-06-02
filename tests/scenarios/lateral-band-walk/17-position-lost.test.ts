/**
 * Lateral Band Walk — position-lost warning (Fix N).
 *
 * Fires when no usable pose (null landmarks OR core landmarks not visible)
 * for ≥ 3s post-calibration. Repeats at most every 10s while still lost.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildLateralBandWalkPose } from '../../harness/pose-stub';
import { runLateralBandWalkSession, countWarnings } from '../../harness/runner';
import type { LateralBandWalkPoseIntent } from '../../harness/types';

const CAL_MS = 300;

describe('Lateral Band Walk — position-lost warning (Fix N)', () => {
  it('fires position-lost after 3+ seconds of null landmarks post-calibration', () => {
    const frames = buildFrames(
      (tMs): LateralBandWalkPoseIntent | null => {
        if (tMs < CAL_MS) return { hipXDisplacement: 0 };
        // Post-cal: no usable landmarks
        return null;
      },
      buildLateralBandWalkPose,
      { fps: 30, durationMs: CAL_MS + 4000 },
    );

    const result = runLateralBandWalkSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'position-lost')).toBeGreaterThan(0);
  });

  it('does NOT fire position-lost on a clean continuous stream', () => {
    const frames = buildFrames(
      (): LateralBandWalkPoseIntent => ({ hipXDisplacement: 0 }),
      buildLateralBandWalkPose,
      { fps: 30, durationMs: 4000 },
    );

    const result = runLateralBandWalkSession(frames);
    expect(countWarnings(result, 'position-lost')).toBe(0);
  });

  it('does NOT fire position-lost during the calibration phase (before confirmed)', () => {
    // Null frames before calibration is confirmed — position-lost should NOT fire
    // because the engine is not yet in tracking mode.
    const frames = buildFrames(
      (tMs): LateralBandWalkPoseIntent | null => {
        if (tMs < 1500) return null;
        return { hipXDisplacement: 0 };
      },
      buildLateralBandWalkPose,
      { fps: 30, durationMs: 3000 },
    );

    const result = runLateralBandWalkSession(frames);
    expect(countWarnings(result, 'position-lost')).toBe(0);
  });

  it('does NOT re-fire position-lost within the 10s cooldown', () => {
    // 5s of null post-cal — should fire exactly once at ~3s mark, not again before 10s.
    const frames = buildFrames(
      (tMs): LateralBandWalkPoseIntent | null => {
        if (tMs < CAL_MS) return { hipXDisplacement: 0 };
        return null;
      },
      buildLateralBandWalkPose,
      { fps: 30, durationMs: CAL_MS + 5000 },
    );

    const result = runLateralBandWalkSession(frames);
    expect(countWarnings(result, 'position-lost')).toBe(1);
  });
});
