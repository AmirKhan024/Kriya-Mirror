/**
 * Regression test for HANDOFF §4.5 Fix B + round-10 streak debounce on
 * Single-Leg Stand. Mirrors tandem-stand's `06-discard-bad-form-time` exactly:
 *
 *  - Clean hold accumulates the full duration.
 *  - Sustained `swaying` freezes the hold counter (Fix B).
 *  - Sustained `hip-tilted` freezes the counter too (HANDOFF §4.5 treats it
 *    as structural — a dropped hip means the lifted leg is near the floor).
 *  - Brief sub-1s freeze blips don't end the longest-hold streak (round 10
 *    debounce). Sustained > 1s freezes DO commit the streak.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildSingleLegStandPose } from '../../harness/pose-stub';
import { runSingleLegStandSession } from '../../harness/runner';
import type { SingleLegStandPoseIntent } from '../../harness/types';

const CAL_MS = 2200;

describe('Single Leg Stand — discard bad-form time from hold counter (HANDOFF §4.5 Fix B)', () => {
  it('counts full hold (~12s) when form is clean throughout', () => {
    const frames = buildFrames(
      () => ({ liftedSide: 'left' as const } as SingleLegStandPoseIntent),
      buildSingleLegStandPose,
      { fps: 30, durationMs: CAL_MS + 10000 },
    );
    const result = runSingleLegStandSession(frames);
    const lastTick = result.holdTicks[result.holdTicks.length - 1];
    expect(lastTick).toBeDefined();
    // Cal-confirm ~200ms + HOLD_BASELINE_FRAMES (~333ms idle) + ~11.5s valid.
    expect(lastTick.secondsElapsed).toBeGreaterThanOrEqual(10);
    expect(lastTick.secondsElapsed).toBeLessThanOrEqual(12);
  });

  it('freezes the counter during 4s of sustained swaying', () => {
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) {
          return { liftedSide: 'left' as const } as SingleLegStandPoseIntent;
        }
        const tAfter = tMs - CAL_MS;
        const swaying = tAfter >= 3000 && tAfter < 7000;
        return {
          liftedSide: 'left' as const,
          swayX: swaying ? 0.045 : 0,
        } as SingleLegStandPoseIntent;
      },
      buildSingleLegStandPose,
      { fps: 30, durationMs: CAL_MS + 10000 },
    );
    const result = runSingleLegStandSession(frames);
    const lastTick = result.holdTicks[result.holdTicks.length - 1];
    expect(lastTick).toBeDefined();
    // Round 12: hysteresis adds ~200ms of resume delay and slower EMA delays
    // entry by ~1 frame, so the valid window is ~1s shorter than pre-round-12.
    expect(lastTick.secondsElapsed).toBeGreaterThanOrEqual(6);
    expect(lastTick.secondsElapsed).toBeLessThanOrEqual(9);
  });

  it('freezes the counter during 4s of sustained hip-tilt (HANDOFF §4.5)', () => {
    // hipDrop > shoulderWidth × HIP_TILT_RATIO (0.15) → ~0.024+ in normalized
    // y-units. Use 0.04 to clearly exceed.
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) {
          return { liftedSide: 'left' as const } as SingleLegStandPoseIntent;
        }
        const tAfter = tMs - CAL_MS;
        const tilting = tAfter >= 3000 && tAfter < 7000;
        return {
          liftedSide: 'left' as const,
          hipDrop: tilting ? 0.04 : 0,
        } as SingleLegStandPoseIntent;
      },
      buildSingleLegStandPose,
      { fps: 30, durationMs: CAL_MS + 10000 },
    );
    const result = runSingleLegStandSession(frames);
    expect(result.broken).toBe(false);
    const lastTick = result.holdTicks[result.holdTicks.length - 1];
    expect(lastTick).toBeDefined();
    // Round 12: hysteresis adds ~200ms of resume delay and slower EMA delays
    // entry by ~1 frame, so the valid window is ~1s shorter than pre-round-12.
    expect(lastTick.secondsElapsed).toBeGreaterThanOrEqual(6);
    expect(lastTick.secondsElapsed).toBeLessThanOrEqual(9);
  });

  it('freezes the counter during 4s of foot-dropped (round 11)', () => {
    // 2026-05-25 round 11: foot-dropped joins swaying + hip-tilted as a
    // freeze trigger. liftElevation 0.01 falls below FOOT_DROPPED_RATIO * shoulderWidth.
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) {
          return { liftedSide: 'left' as const } as SingleLegStandPoseIntent;
        }
        const tAfter = tMs - CAL_MS;
        const footDown = tAfter >= 3000 && tAfter < 7000;
        return {
          liftedSide: 'left' as const,
          liftElevation: footDown ? 0.01 : 0.10,
        } as SingleLegStandPoseIntent;
      },
      buildSingleLegStandPose,
      { fps: 30, durationMs: CAL_MS + 10000 },
    );
    const result = runSingleLegStandSession(frames);
    expect(result.broken).toBe(false);
    const lastTick = result.holdTicks[result.holdTicks.length - 1];
    expect(lastTick).toBeDefined();
    // ~8s of valid time (4s of foot-down frozen, ~12s wall-clock total - ~2s
    // cal phase overlap - 4s freeze = ~8s ticks).
    // Round 12: hysteresis adds ~200ms of resume delay and slower EMA delays
    // entry by ~1 frame, so the valid window is ~1s shorter than pre-round-12.
    expect(lastTick.secondsElapsed).toBeGreaterThanOrEqual(6);
    expect(lastTick.secondsElapsed).toBeLessThanOrEqual(9);
  });

  it('round 10: a sustained > 1s break commits and resets the longest-hold streak', () => {
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) {
          return { liftedSide: 'left' as const } as SingleLegStandPoseIntent;
        }
        const tAfter = tMs - CAL_MS;
        const swayPhase = tAfter >= 3000 && tAfter < 5000;
        return {
          liftedSide: 'left' as const,
          swayX: swayPhase ? 0.045 : 0,
        } as SingleLegStandPoseIntent;
      },
      buildSingleLegStandPose,
      { fps: 30, durationMs: CAL_MS + 8000 },
    );
    const result = runSingleLegStandSession(frames);
    const lastTick = result.holdTicks[result.holdTicks.length - 1];
    expect(lastTick).toBeDefined();
    expect(lastTick.longestUnfrozenSec).toBeDefined();
    // Longest of two ~3s clean segments around a 2s sustained break.
    expect(lastTick.longestUnfrozenSec!).toBeGreaterThanOrEqual(2);
    expect(lastTick.longestUnfrozenSec!).toBeLessThanOrEqual(5);
  });
});
