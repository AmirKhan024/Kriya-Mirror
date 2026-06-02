/**
 * Regression test for Fix N (`position-lost`) on Calf Raise. Mirrors the
 * bicep-curl test exactly.
 *
 * Spec: if no usable pose frame (landmarks null OR core body landmarks
 * not visible) for ≥ 3 seconds post-calibration, the engine emits
 * `position-lost`. Repeats at most every 10 s while still lost.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildCalfRaisePose } from '../../harness/pose-stub';
import { runCalfRaiseSession, countWarnings } from '../../harness/runner';
import type { CalfRaisePoseIntent } from '../../harness/types';

const CAL_MS = 2200;

describe('Calf Raise — position-lost warning (Fix N)', () => {
  it('fires position-lost after 3+ seconds of null landmarks post-calibration', () => {
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) return { heelRisePct: 0 } as CalfRaisePoseIntent;
        return null;
      },
      buildCalfRaisePose,
      { fps: 30, durationMs: CAL_MS + 4000 },
    );

    const result = runCalfRaiseSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'position-lost')).toBeGreaterThan(0);
  });

  it('does NOT fire position-lost on a clean continuous stream', () => {
    const frames = buildFrames(
      () => ({ heelRisePct: 0 } as CalfRaisePoseIntent),
      buildCalfRaisePose,
      { fps: 30, durationMs: 4000 },
    );

    const result = runCalfRaiseSession(frames);
    expect(countWarnings(result, 'position-lost')).toBe(0);
  });

  it('does NOT fire position-lost during the brief calibration phase', () => {
    const frames = buildFrames(
      (tMs) => {
        if (tMs < 1500) return null;
        return { heelRisePct: 0 } as CalfRaisePoseIntent;
      },
      buildCalfRaisePose,
      { fps: 30, durationMs: 3000 },
    );

    const result = runCalfRaiseSession(frames);
    expect(countWarnings(result, 'position-lost')).toBe(0);
  });

  it('does NOT re-fire position-lost within the 10s cooldown', () => {
    // 5 seconds of null post-cal — should fire exactly once (at the 3 s mark).
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) return { heelRisePct: 0 } as CalfRaisePoseIntent;
        return null;
      },
      buildCalfRaisePose,
      { fps: 30, durationMs: CAL_MS + 5000 },
    );

    const result = runCalfRaiseSession(frames);
    expect(countWarnings(result, 'position-lost')).toBe(1);
  });

  // 2026-05-28 round 22: sustained position-lost escalates to hold-broken
  // (the user has clearly left frame / given up). At 10 s of continuous loss
  // the engine fires onHoldBroken and finishes.
  it('escalates to hold-broken after 10 s of sustained position-lost (round 22)', () => {
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) return { heelRisePct: 0 } as CalfRaisePoseIntent;
        return null;
      },
      buildCalfRaisePose,
      { fps: 30, durationMs: CAL_MS + 11_000 },
    );

    const result = runCalfRaiseSession(frames);
    expect(result.holdBroken).toBe(true);
  });
});
