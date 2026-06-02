/**
 * Regression test for the round-9 `hands-off-hips` coaching cue on tandem stand.
 *
 * Spec:
 *  - Fires after ~2 seconds of sustained off-hips (wrists not near the hips).
 *  - Does NOT freeze the hold counter (purely a verbal nudge).
 *  - Respects a 12-second repeat cooldown — after firing, doesn't fire again
 *    for another 12 seconds even if hands stay off the hips.
 *  - Brief wrist flicks (<2s sustained) don't fire.
 *
 * Reference: vanilla-JS hip_gate implementation at mobility_new/hip_gate.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildTandemStandPose } from '../../harness/pose-stub';
import { runTandemStandSession, countWarnings } from '../../harness/runner';
import type { TandemStandPoseIntent } from '../../harness/types';

const CAL_MS = 2200;

describe('Tandem Stand — hands-off-hips warning (round 9)', () => {
  it('does NOT fire when hands stay on hips (sanity)', () => {
    const frames = buildFrames(
      () => ({ tandemAhead: 'left' as const, handsOnHips: true } as TandemStandPoseIntent),
      buildTandemStandPose,
      { fps: 30, durationMs: CAL_MS + 10_000 },
    );
    const result = runTandemStandSession(frames);
    expect(countWarnings(result, 'hands-off-hips')).toBe(0);
  });

  it('fires exactly once after ~2s of sustained off-hips', () => {
    // Hands off the hips for ~5s — should fire ONCE at ~2s confirm window,
    // then not refire within the 12s cooldown.
    const frames = buildFrames(
      (tMs) => {
        const handsOnHips = tMs < CAL_MS + 1000;
        return { tandemAhead: 'left' as const, handsOnHips } as TandemStandPoseIntent;
      },
      buildTandemStandPose,
      { fps: 30, durationMs: CAL_MS + 6000 },
    );
    const result = runTandemStandSession(frames);
    expect(countWarnings(result, 'hands-off-hips')).toBe(1);
  });

  it('fires twice over a sustained 15s off-hips period (12s cooldown elapsed)', () => {
    // Hands off from CAL_MS+1000 onwards for ~15s. Expected fires:
    //   t ≈ CAL_MS + 3000 (1000 grace + 2000 confirm)
    //   t ≈ CAL_MS + 15000 (12s cooldown later)
    const frames = buildFrames(
      (tMs) => {
        const handsOnHips = tMs < CAL_MS + 1000;
        return { tandemAhead: 'left' as const, handsOnHips } as TandemStandPoseIntent;
      },
      buildTandemStandPose,
      { fps: 30, durationMs: CAL_MS + 16_000 },
    );
    const result = runTandemStandSession(frames);
    expect(countWarnings(result, 'hands-off-hips')).toBe(2);
  });

  it('does NOT fire for a brief 500ms wrist flick (below 2s confirm)', () => {
    const frames = buildFrames(
      (tMs) => {
        const tAfter = tMs - CAL_MS;
        const inFlick = tAfter >= 3000 && tAfter < 3500;
        return {
          tandemAhead: 'left' as const,
          handsOnHips: !inFlick,
        } as TandemStandPoseIntent;
      },
      buildTandemStandPose,
      { fps: 30, durationMs: CAL_MS + 8000 },
    );
    const result = runTandemStandSession(frames);
    expect(countWarnings(result, 'hands-off-hips')).toBe(0);
  });

  it('does NOT freeze the hold counter while hands are off hips', () => {
    // Hands off hips entirely (post-cal). Timer should keep ticking — final
    // tick should reflect roughly full wall-clock time (minus baseline-capture).
    const frames = buildFrames(
      (tMs) => {
        const handsOnHips = tMs < CAL_MS;
        return { tandemAhead: 'left' as const, handsOnHips } as TandemStandPoseIntent;
      },
      buildTandemStandPose,
      { fps: 30, durationMs: CAL_MS + 10_000 },
    );
    const result = runTandemStandSession(frames);
    const lastTick = result.holdTicks[result.holdTicks.length - 1];
    expect(lastTick).toBeDefined();
    // Same range as the clean-hold case — hands-off-hips does NOT freeze.
    expect(lastTick.secondsElapsed).toBeGreaterThanOrEqual(10);
    expect(lastTick.secondsElapsed).toBeLessThanOrEqual(12);
  });
});
