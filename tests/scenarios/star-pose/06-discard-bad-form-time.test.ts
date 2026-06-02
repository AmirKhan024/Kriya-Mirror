/**
 * Fix B (freeze the hold counter during sustained bad form) + Fix U (longest-
 * hold streak with 1 s debounce) for Star Pose. Mirrors the single-leg-stand
 * discard test. `swaying` and `foot-dropped` freeze the counter; `arms-dropped`
 * (a coaching cue) does NOT.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildStarPosePose } from '../../harness/pose-stub';
import { runStarPoseSession } from '../../harness/runner';
import type { StarPosePoseIntent } from '../../harness/types';

const CAL_MS = 2200;

describe('Star Pose — discard bad-form time from hold counter (Fix B)', () => {
  it('counts the full hold (~10s) when form is clean throughout', () => {
    const frames = buildFrames(
      () => ({ liftedSide: 'left' as const } as StarPosePoseIntent),
      buildStarPosePose,
      { fps: 30, durationMs: CAL_MS + 10000 },
    );
    const result = runStarPoseSession(frames);
    const lastTick = result.holdTicks[result.holdTicks.length - 1];
    expect(lastTick).toBeDefined();
    expect(lastTick.secondsElapsed).toBeGreaterThanOrEqual(10);
    expect(lastTick.secondsElapsed).toBeLessThanOrEqual(12);
  });

  it('freezes the counter during 4s of sustained swaying', () => {
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) return { liftedSide: 'left' as const } as StarPosePoseIntent;
        const tAfter = tMs - CAL_MS;
        const swaying = tAfter >= 3000 && tAfter < 7000;
        return { liftedSide: 'left' as const, swayX: swaying ? 0.058 : 0 } as StarPosePoseIntent;
      },
      buildStarPosePose,
      { fps: 30, durationMs: CAL_MS + 10000 },
    );
    const result = runStarPoseSession(frames);
    const lastTick = result.holdTicks[result.holdTicks.length - 1];
    expect(lastTick).toBeDefined();
    expect(lastTick.secondsElapsed).toBeGreaterThanOrEqual(6);
    expect(lastTick.secondsElapsed).toBeLessThanOrEqual(9);
  });

  it('freezes the counter during 4s of foot-dropped (extended leg lowered)', () => {
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) return { liftedSide: 'left' as const } as StarPosePoseIntent;
        const tAfter = tMs - CAL_MS;
        const footDown = tAfter >= 3000 && tAfter < 7000;
        return { liftedSide: 'left' as const, liftElevation: footDown ? 0 : 0.10 } as StarPosePoseIntent;
      },
      buildStarPosePose,
      { fps: 30, durationMs: CAL_MS + 10000 },
    );
    const result = runStarPoseSession(frames);
    expect(result.broken).toBe(false);
    const lastTick = result.holdTicks[result.holdTicks.length - 1];
    expect(lastTick).toBeDefined();
    expect(lastTick.secondsElapsed).toBeGreaterThanOrEqual(6);
    expect(lastTick.secondsElapsed).toBeLessThanOrEqual(9);
  });

  it('a sustained > 1s break commits and resets the longest-hold streak (Fix U)', () => {
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) return { liftedSide: 'left' as const } as StarPosePoseIntent;
        const tAfter = tMs - CAL_MS;
        const swayPhase = tAfter >= 3000 && tAfter < 5000;
        return { liftedSide: 'left' as const, swayX: swayPhase ? 0.058 : 0 } as StarPosePoseIntent;
      },
      buildStarPosePose,
      { fps: 30, durationMs: CAL_MS + 8000 },
    );
    const result = runStarPoseSession(frames);
    const lastTick = result.holdTicks[result.holdTicks.length - 1];
    expect(lastTick).toBeDefined();
    expect(lastTick.longestUnfrozenSec).toBeDefined();
    expect(lastTick.longestUnfrozenSec!).toBeGreaterThanOrEqual(2);
    expect(lastTick.longestUnfrozenSec!).toBeLessThanOrEqual(5);
  });
});
