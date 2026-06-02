/**
 * Fix U — longest-streak debounce. A freeze blip shorter than
 * MIN_STREAK_BREAK_MS=1000 is absorbed into the ongoing streak; a sustained
 * ≥1s freeze commits the streak.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildWallSitPose } from '../../harness/pose-stub';
import { runWallSitSession } from '../../harness/runner';
import type { WallSitPoseIntent } from '../../harness/types';

const CAL_MS = 2200;
const HOLD_START = CAL_MS;

describe('Wall Sit — longest-streak debounce (Fix U)', () => {
  it('reports a multi-second streak when held cleanly', () => {
    const frames = buildFrames(
      () => ({ kneeFlexionDeg: 90, side: 'left' as const } as WallSitPoseIntent),
      buildWallSitPose,
      { fps: 30, durationMs: HOLD_START + 8000 },
    );
    const result = runWallSitSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    const lastTick = result.holdTicks[result.holdTicks.length - 1];
    expect(lastTick.longestUnfrozenSec).toBeGreaterThanOrEqual(5);
  });

  it('commits the streak after a sustained ≥1s freeze (longestUnfrozenSec < total elapsed)', () => {
    // 8s clean → 1.5s knee-too-straight (commits the freeze) → 4s clean.
    const frames = buildFrames(
      (tMs): WallSitPoseIntent => {
        const intoHold = tMs - HOLD_START;
        if (intoHold < 8000) return { kneeFlexionDeg: 90, side: 'left' };
        if (intoHold < 9500) return { kneeFlexionDeg: 25, side: 'left' };
        return { kneeFlexionDeg: 90, side: 'left' };
      },
      buildWallSitPose,
      { fps: 30, durationMs: HOLD_START + 13_500 },
    );
    const result = runWallSitSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    const lastTick = result.holdTicks[result.holdTicks.length - 1];
    expect(lastTick.longestUnfrozenSec).toBeGreaterThanOrEqual(7);
    expect(lastTick.longestUnfrozenSec).toBeLessThanOrEqual(10);
  });
});
