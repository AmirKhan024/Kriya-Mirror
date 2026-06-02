/**
 * Fix U — longest-streak debounce. A freeze blip shorter than
 * MIN_STREAK_BREAK_MS=1000 is absorbed into the ongoing streak (user perceives
 * it as one continuous hold). A sustained ≥1s freeze commits the streak.
 *
 * Note: chair-pose's form-warning hysteresis (Fix V) requires 6 sustained
 * "bad" frames (~200ms at 30fps) before fire. A 500ms blip = ~15 bad frames,
 * which DOES cross the warning threshold + freeze the timer, but a) only
 * for ~300ms of "freeze duration" once the hysteresis catches up, b) the
 * streak break never exceeds 1s, so Fix U absorbs it.
 *
 * For the sustained case we use a 1500ms bad window — clearly exceeds
 * MIN_STREAK_BREAK_MS, so the streak commits.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildChairPosePose } from '../../harness/pose-stub';
import { runChairPoseSession } from '../../harness/runner';
import type { ChairPosePoseIntent } from '../../harness/types';

const CAL_MS = 2200;
const HOLD_START = CAL_MS;

describe('Chair Pose — longest-streak debounce (Fix U)', () => {
  it('reports a 1-second-or-more streak when held cleanly', () => {
    const frames = buildFrames(
      () => ({ kneeFlexionDeg: 90, side: 'left' as const } as ChairPosePoseIntent),
      buildChairPosePose,
      { fps: 30, durationMs: HOLD_START + 8000 },
    );
    const result = runChairPoseSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    const lastTick = result.holdTicks[result.holdTicks.length - 1];
    expect(lastTick.longestUnfrozenSec).toBeGreaterThanOrEqual(5);
  });

  it('commits the streak after a sustained ≥1s freeze (longestUnfrozenSec < total elapsed)', () => {
    // 8s clean → 1.5s knee-too-straight (commits the freeze per MIN_STREAK_BREAK_MS=1000)
    // → 4s clean. The first 8-second streak commits to longest, then the
    // second 4-second streak starts fresh — so the FINAL longestUnfrozen
    // streak should reflect the 8s, not the full ~12s of valid time.
    const frames = buildFrames(
      (tMs): ChairPosePoseIntent => {
        const intoHold = tMs - HOLD_START;
        if (intoHold < 8000) return { kneeFlexionDeg: 90, side: 'left' };
        if (intoHold < 9500) return { kneeFlexionDeg: 25, side: 'left' };
        return { kneeFlexionDeg: 90, side: 'left' };
      },
      buildChairPosePose,
      { fps: 30, durationMs: HOLD_START + 13_500 },
    );
    const result = runChairPoseSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    const lastTick = result.holdTicks[result.holdTicks.length - 1];
    // After cal + 8s clean: streak ~8s. Then 1.5s freeze commits. Then 4s
    // clean restarts. Final longest is whichever of the two streaks is bigger.
    expect(lastTick.longestUnfrozenSec).toBeGreaterThanOrEqual(7);
    expect(lastTick.longestUnfrozenSec).toBeLessThanOrEqual(10);
  });
});
