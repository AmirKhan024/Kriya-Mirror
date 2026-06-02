/**
 * Regression test for the round-6 cross-cutting `position-lost` warning,
 * now wired into Tandem Stand (the first hold-based engine to receive it).
 *
 * Spec: if no usable pose frame (landmarks null OR core body landmarks
 * not visible) for ≥ 3 seconds post-calibration, the engine emits
 * `position-lost`. Repeats at most every 10s while still lost.
 *
 * Mirrors `tests/scenarios/lunge/17-position-lost.test.ts`.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildTandemStandPose } from '../../harness/pose-stub';
import { runTandemStandSession, countWarnings } from '../../harness/runner';
import type { TandemStandPoseIntent } from '../../harness/types';

const CAL_MS = 2200;

describe('Tandem Stand — position-lost warning (round 6)', () => {
  it('fires position-lost after 3+ seconds of null landmarks post-calibration', () => {
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) {
          return { tandemAhead: 'left' as const } as TandemStandPoseIntent;
        }
        // Post-cal: user stepped out — no usable frame.
        return null;
      },
      buildTandemStandPose,
      { fps: 30, durationMs: CAL_MS + 4000 },
    );

    const result = runTandemStandSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'position-lost')).toBeGreaterThan(0);
  });

  it('does NOT fire position-lost on a clean continuous stream', () => {
    const frames = buildFrames(
      () => ({ tandemAhead: 'left' as const } as TandemStandPoseIntent),
      buildTandemStandPose,
      { fps: 30, durationMs: 4000 },
    );

    const result = runTandemStandSession(frames);
    expect(countWarnings(result, 'position-lost')).toBe(0);
  });

  it('does NOT fire position-lost during the brief calibration phase', () => {
    // Null frames pre-cal-confirm shouldn't trip the warning — the engine
    // isn't yet confirmed. The calibration timeout retry path handles this.
    const frames = buildFrames(
      (tMs) => {
        if (tMs < 1500) return null;
        return { tandemAhead: 'left' as const } as TandemStandPoseIntent;
      },
      buildTandemStandPose,
      { fps: 30, durationMs: 3000 },
    );

    const result = runTandemStandSession(frames);
    expect(countWarnings(result, 'position-lost')).toBe(0);
  });

  it('does NOT re-fire position-lost within the 10s cooldown', () => {
    // 5 seconds of null post-cal — should fire exactly once (at the 3s mark).
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) {
          return { tandemAhead: 'left' as const } as TandemStandPoseIntent;
        }
        return null;
      },
      buildTandemStandPose,
      { fps: 30, durationMs: CAL_MS + 5000 },
    );

    const result = runTandemStandSession(frames);
    expect(countWarnings(result, 'position-lost')).toBe(1);
  });
});
