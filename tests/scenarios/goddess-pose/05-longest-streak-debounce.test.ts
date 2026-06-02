/**
 * Fix U — longest-streak debounce. A freeze blip shorter than
 * MIN_STREAK_BREAK_MS=1000 is absorbed into the ongoing streak (user
 * perceives it as one continuous hold). A sustained ≥ 1 s freeze commits
 * the streak.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildGoddessPosePose } from '../../harness/pose-stub';
import { runGoddessPoseSession } from '../../harness/runner';
import type { GoddessPosePoseIntent } from '../../harness/types';

const CAL_MS = 2200;
const HOLD_START = CAL_MS;

describe('Goddess Pose — longest-streak debounce (Fix U)', () => {
  it('reports a multi-second streak when held cleanly', () => {
    const frames = buildFrames(
      () => ({ kneeFlexionDeg: 90 } as GoddessPosePoseIntent),
      buildGoddessPosePose,
      { fps: 30, durationMs: HOLD_START + 8000 },
    );
    const result = runGoddessPoseSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    const lastTick = result.holdTicks[result.holdTicks.length - 1];
    expect(lastTick.longestUnfrozenSec).toBeGreaterThanOrEqual(5);
  });

  it('commits the streak after a sustained ≥ 1 s freeze', () => {
    // 8s clean → 1.5s knees-caving (sustained, commits per MIN_STREAK_BREAK_MS=1000)
    // → 4s clean. The first 8-second streak commits to longest; the second
    // 4-second streak starts fresh. Final longestUnfrozenSec ≈ 8.
    const frames = buildFrames(
      (tMs): GoddessPosePoseIntent => {
        const intoHold = tMs - HOLD_START;
        if (intoHold < 8000) return { kneeFlexionDeg: 90 };
        if (intoHold < 9500) return { kneeFlexionDeg: 90, kneeAnkleRatio: 0.5 };
        return { kneeFlexionDeg: 90 };
      },
      buildGoddessPosePose,
      { fps: 30, durationMs: HOLD_START + 13_500 },
    );
    const result = runGoddessPoseSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    const lastTick = result.holdTicks[result.holdTicks.length - 1];
    expect(lastTick.longestUnfrozenSec).toBeGreaterThanOrEqual(7);
    expect(lastTick.longestUnfrozenSec).toBeLessThanOrEqual(10);
  });
});
