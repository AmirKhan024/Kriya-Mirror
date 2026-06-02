/**
 * Regression test for Fix N (`position-lost`) on High Knees.
 *
 * Spec: if no usable pose frame for ≥ 3 s post-calibration, the engine emits
 * `position-lost`. Repeats at most every 10 s while still lost.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildHighKneesPose } from '../../harness/pose-stub';
import { runHighKneesSession, countWarnings } from '../../harness/runner';
import type { HighKneesPoseIntent } from '../../harness/types';

const CAL_MS = 2200;

describe('High Knees — position-lost warning (Fix N)', () => {
  it('fires position-lost after 3+ seconds of null landmarks post-calibration', () => {
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) return { leftKneeLiftPct: 0, rightKneeLiftPct: 0 } as HighKneesPoseIntent;
        return null;
      },
      buildHighKneesPose,
      { fps: 30, durationMs: CAL_MS + 4000 },
    );

    const result = runHighKneesSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'position-lost')).toBeGreaterThan(0);
  });

  it('does NOT fire position-lost on a clean continuous stream', () => {
    const frames = buildFrames(
      () => ({ leftKneeLiftPct: 0, rightKneeLiftPct: 0 } as HighKneesPoseIntent),
      buildHighKneesPose,
      { fps: 30, durationMs: 4000 },
    );

    const result = runHighKneesSession(frames);
    expect(countWarnings(result, 'position-lost')).toBe(0);
  });

  it('does NOT fire position-lost during the brief calibration phase', () => {
    const frames = buildFrames(
      (tMs) => {
        if (tMs < 1500) return null;
        return { leftKneeLiftPct: 0, rightKneeLiftPct: 0 } as HighKneesPoseIntent;
      },
      buildHighKneesPose,
      { fps: 30, durationMs: 3000 },
    );

    const result = runHighKneesSession(frames);
    expect(countWarnings(result, 'position-lost')).toBe(0);
  });

  it('does NOT re-fire position-lost within the 10s cooldown', () => {
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) return { leftKneeLiftPct: 0, rightKneeLiftPct: 0 } as HighKneesPoseIntent;
        return null;
      },
      buildHighKneesPose,
      { fps: 30, durationMs: CAL_MS + 5000 },
    );

    const result = runHighKneesSession(frames);
    expect(countWarnings(result, 'position-lost')).toBe(1);
  });
});
