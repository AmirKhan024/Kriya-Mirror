import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildStarPosePose } from '../../harness/pose-stub';
import { runStarPoseSession, countWarnings } from '../../harness/runner';
import type { StarPosePoseIntent } from '../../harness/types';

const CAL_MS = 2200;

describe('Star Pose — posture warnings', () => {
  it('fires foot-dropped when the extended leg lowers back down (recoverable, no break)', () => {
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS + 3000) return { liftedSide: 'left' as const } as StarPosePoseIntent;
        // liftElevation 0 → ankleYDelta/0.16 = 0 < FOOT_DROPPED_LIFT_FLOOR (0.03).
        return { liftedSide: 'left' as const, liftElevation: 0 } as StarPosePoseIntent;
      },
      buildStarPosePose,
      { fps: 30, durationMs: CAL_MS + 6000 },
    );
    const result = runStarPoseSession(frames);
    expect(result.broken).toBe(false);
    expect(countWarnings(result, 'foot-dropped')).toBeGreaterThan(0);
  });

  it('fires foot-dropped when the extended leg retracts in from the wide star', () => {
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS + 3000) return { liftedSide: 'left' as const } as StarPosePoseIntent;
        // legSpread 0.05 → ankleXSep ≈ 0.09; 0.09/0.16 ≈ 0.56 < FOOT_DROPPED_WIDE_FLOOR (1.0).
        return { liftedSide: 'left' as const, legSpread: 0.05 } as StarPosePoseIntent;
      },
      buildStarPosePose,
      { fps: 30, durationMs: CAL_MS + 6000 },
    );
    const result = runStarPoseSession(frames);
    expect(result.broken).toBe(false);
    expect(countWarnings(result, 'foot-dropped')).toBeGreaterThan(0);
  });

  it('fires arms-dropped coaching cue when both arms come down — does NOT freeze/break the hold', () => {
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS + 3000) return { liftedSide: 'left' as const } as StarPosePoseIntent;
        return { liftedSide: 'left' as const, armsUp: false } as StarPosePoseIntent;
      },
      buildStarPosePose,
      { fps: 30, durationMs: CAL_MS + 8000 },
    );
    const result = runStarPoseSession(frames);
    expect(countWarnings(result, 'arms-dropped')).toBeGreaterThan(0);
    expect(result.broken).toBe(false);
    // Arms-dropped must NOT freeze the timer — the counter keeps climbing.
    const lastTick = result.holdTicks[result.holdTicks.length - 1];
    expect(lastTick).toBeDefined();
    expect(lastTick.secondsElapsed).toBeGreaterThanOrEqual(6);
  });

  it('fires too-far nudge when the user drifts too far mid-hold', () => {
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS + 3000) return { liftedSide: 'left' as const } as StarPosePoseIntent;
        // shoulderWidthOverride 0.05 < RUNTIME_MIN_SHOULDER_WIDTH (0.07) → too-far.
        return { liftedSide: 'left' as const, shoulderWidthOverride: 0.05 } as StarPosePoseIntent;
      },
      buildStarPosePose,
      { fps: 30, durationMs: CAL_MS + 6000 },
    );
    const result = runStarPoseSession(frames);
    expect(countWarnings(result, 'too-far')).toBeGreaterThan(0);
  });

  it('clean hold fires no foot-dropped / arms-dropped / distance warnings', () => {
    const frames = buildFrames(
      () => ({ liftedSide: 'left' as const } as StarPosePoseIntent),
      buildStarPosePose,
      { fps: 30, durationMs: CAL_MS + 8000 },
    );
    const result = runStarPoseSession(frames);
    expect(countWarnings(result, 'foot-dropped')).toBe(0);
    expect(countWarnings(result, 'arms-dropped')).toBe(0);
    expect(countWarnings(result, 'too-far')).toBe(0);
    expect(countWarnings(result, 'too-close')).toBe(0);
  });
});
