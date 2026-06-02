/**
 * Regression test for HANDOFF §4.4 Fix B on Tandem Stand: the hold counter
 * must freeze during sustained `swaying`, mirroring plank's freeze mechanic.
 * Before this change tandem-stand ticked wall-clock seconds — a user who
 * held for 20s but swayed visibly for 5s still saw "20s" on the counter.
 *
 * After the fix, `accumulatedValidMs` only grows on frames where the swaying
 * debounce isn't tripped. `feet-separated` is excluded (it's a hold-broken
 * trigger; the hold ends entirely, so freeze accounting doesn't apply).
 *
 * Mirrors `tests/scenarios/plank/05-discard-bad-form-time.test.ts`.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildTandemStandPose } from '../../harness/pose-stub';
import { runTandemStandSession } from '../../harness/runner';
import type { TandemStandPoseIntent } from '../../harness/types';

// Round-5 instant cal — confirms in ~200ms, so by CAL_MS=2200 the engine has
// already been accumulating valid hold time for ~2s.
const CAL_MS = 2200;

describe('Tandem Stand — discard bad-form time from hold counter (HANDOFF §4.4 Fix B)', () => {
  it('counts full hold (~12s) when form is clean throughout', () => {
    const frames = buildFrames(
      () => ({ tandemAhead: 'left' as const } as TandemStandPoseIntent),
      buildTandemStandPose,
      { fps: 30, durationMs: CAL_MS + 10000 },
    );
    const result = runTandemStandSession(frames);
    const lastTick = result.holdTicks[result.holdTicks.length - 1];
    expect(lastTick).toBeDefined();
    // Accumulator runs from cal-confirm (~200ms) + HOLD_BASELINE_FRAMES (~333ms
    // at 30fps with no accumulation) → ~12200ms = ~11.5s of valid time. Allow
    // 1s of slack for the baseline-capture phase + edge timing.
    expect(lastTick.secondsElapsed).toBeGreaterThanOrEqual(10);
    expect(lastTick.secondsElapsed).toBeLessThanOrEqual(12);
  });

  it('freezes the counter during 4s of sustained swaying in the middle', () => {
    // Total ~12s post-cal-confirm: ~2s clean before CAL_MS + 3s clean + 4s frozen +
    // 3s clean = ~8s of valid time at the last tick.
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) {
          return { tandemAhead: 'left' as const } as TandemStandPoseIntent;
        }
        const tAfter = tMs - CAL_MS;
        const swaying = tAfter >= 3000 && tAfter < 7000;
        return {
          tandemAhead: 'left' as const,
          swayX: swaying ? 0.025 : 0,
        } as TandemStandPoseIntent;
      },
      buildTandemStandPose,
      { fps: 30, durationMs: CAL_MS + 10000 },
    );
    const result = runTandemStandSession(frames);
    const lastTick = result.holdTicks[result.holdTicks.length - 1];
    expect(lastTick).toBeDefined();
    // ~8s of valid time. Slack for SWAY_WARN_FRAMES=6 debounce + EMA ramp on either edge.
    // Round 12: hysteresis adds ~200ms of resume delay and slower EMA delays
    // entry by ~1 frame, so the valid window is ~1s shorter than pre-round-12.
    expect(lastTick.secondsElapsed).toBeGreaterThanOrEqual(6);
    expect(lastTick.secondsElapsed).toBeLessThanOrEqual(9);
  });

  it('does NOT deduct for a brief 100ms sway wobble (below 6-frame debounce)', () => {
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) {
          return { tandemAhead: 'left' as const } as TandemStandPoseIntent;
        }
        const tAfter = tMs - CAL_MS;
        const inWobble = tAfter >= 5000 && tAfter < 5100; // ~3 frames at 30fps
        return {
          tandemAhead: 'left' as const,
          swayX: inWobble ? 0.03 : 0,
        } as TandemStandPoseIntent;
      },
      buildTandemStandPose,
      { fps: 30, durationMs: CAL_MS + 10000 },
    );
    const result = runTandemStandSession(frames);
    const lastTick = result.holdTicks[result.holdTicks.length - 1];
    expect(lastTick).toBeDefined();
    // Same expected range as the clean-hold case (a 3-frame wobble doesn't
    // pass the 6-frame swaying debounce, so no time is deducted).
    expect(lastTick.secondsElapsed).toBeGreaterThanOrEqual(10);
    expect(lastTick.secondsElapsed).toBeLessThanOrEqual(12);
  });

  it('freezes the counter during 4s of sustained feet-separation (round 9)', () => {
    // 2026-05-25 round 9: feet-separated joins swaying as a freeze trigger.
    // ankleXSeparation 0.10 = ratio 0.62, above the FEET_SEPARATED_RATIO=0.45
    // threshold. Pattern matches the swaying-freeze case above.
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) {
          return { tandemAhead: 'left' as const };
        }
        const tAfter = tMs - CAL_MS;
        const feetApart = tAfter >= 3000 && tAfter < 7000;
        return {
          tandemAhead: 'left' as const,
          ankleXSeparation: feetApart ? 0.10 : 0.030,
        };
      },
      buildTandemStandPose,
      { fps: 30, durationMs: CAL_MS + 10000 },
    );
    const result = runTandemStandSession(frames);
    // Hold must NOT terminate (round-9 behavior).
    expect(result.broken).toBe(false);
    const lastTick = result.holdTicks[result.holdTicks.length - 1];
    expect(lastTick).toBeDefined();
    // ~8s of valid time, same range as the swaying case.
    // Round 12: hysteresis adds ~200ms of resume delay and slower EMA delays
    // entry by ~1 frame, so the valid window is ~1s shorter than pre-round-12.
    expect(lastTick.secondsElapsed).toBeGreaterThanOrEqual(6);
    expect(lastTick.secondsElapsed).toBeLessThanOrEqual(9);
  });

  it('round 10: absorbs sub-1s freeze blips into the ongoing longest-hold streak', () => {
    // Stutter sway in 400ms-on / 400ms-off bursts for 4 seconds (5 cycles).
    // Each freeze is ~400ms (well under MIN_STREAK_BREAK_MS=1000) → none
    // commits. Final longest streak should encompass the entire run minus
    // the small SWAY_WARN_FRAMES=6 debounce ramp on each edge.
    const STUTTER_CYCLE_MS = 800;
    const STUTTER_BAD_MS = 400;
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) {
          return { tandemAhead: 'left' as const };
        }
        const tAfter = tMs - CAL_MS;
        // After 2s of clean hold, do 4 seconds of stutter, then 3s clean.
        if (tAfter < 2000) return { tandemAhead: 'left' as const, swayX: 0 };
        if (tAfter < 6000) {
          const inStutter = (tAfter - 2000) % STUTTER_CYCLE_MS < STUTTER_BAD_MS;
          return { tandemAhead: 'left' as const, swayX: inStutter ? 0.025 : 0 };
        }
        return { tandemAhead: 'left' as const, swayX: 0 };
      },
      buildTandemStandPose,
      { fps: 30, durationMs: CAL_MS + 10_000 },
    );
    const result = runTandemStandSession(frames);
    const lastTick = result.holdTicks[result.holdTicks.length - 1];
    expect(lastTick).toBeDefined();
    expect(lastTick.longestUnfrozenSec).toBeDefined();
    // Total hold window is ~10s post-cal-confirm minus the 333ms baseline
    // capture. With NO commits the streak should span most of it (≥ 7s).
    // (Compare to the OLD per-edge logic which would have produced ~3-4s max.)
    expect(lastTick.longestUnfrozenSec!).toBeGreaterThanOrEqual(7);
  });

  it('round 10: a sustained > 1s break DOES commit and reset the streak', () => {
    // Clean 3s → 2-second sustained sway → clean 3s. The 2s sway exceeds
    // MIN_STREAK_BREAK_MS=1000 → commits. Final longest should be the larger
    // of the two clean segments (~3s each), NOT the sum.
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) return { tandemAhead: 'left' as const };
        const tAfter = tMs - CAL_MS;
        const swayPhase = tAfter >= 3000 && tAfter < 5000;
        return {
          tandemAhead: 'left' as const,
          swayX: swayPhase ? 0.025 : 0,
        };
      },
      buildTandemStandPose,
      { fps: 30, durationMs: CAL_MS + 8000 },
    );
    const result = runTandemStandSession(frames);
    const lastTick = result.holdTicks[result.holdTicks.length - 1];
    expect(lastTick).toBeDefined();
    expect(lastTick.longestUnfrozenSec).toBeDefined();
    // Longest of the two ~3s segments. Should be 2-4 seconds (NOT 6+).
    expect(lastTick.longestUnfrozenSec!).toBeGreaterThanOrEqual(2);
    expect(lastTick.longestUnfrozenSec!).toBeLessThanOrEqual(5);
  });
});
