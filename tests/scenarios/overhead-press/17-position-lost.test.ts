/**
 * Overhead Press — position-lost warning (Fix N):
 *   - Fires after 3s of null/invisible landmarks post-calibration
 *   - Does NOT fire during calibration phase
 *   - Does NOT fire on a clean continuous stream
 *   - Respects 10s cooldown (fires only once in a 5s null window)
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildOverheadPressPose } from '../../harness/pose-stub';
import { runOverheadPressSession, countWarnings } from '../../harness/runner';
import type { OverheadPressPoseIntent } from '../../harness/types';

const CAL_MS = 800;
const RACKED_FLEX = 75;

describe('Overhead Press — position-lost warning (Fix N)', () => {
  it('fires position-lost after 3+ seconds of null landmarks post-calibration', () => {
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) return { elbowFlexionDeg: RACKED_FLEX } as OverheadPressPoseIntent;
        // User stepped out
        return null;
      },
      buildOverheadPressPose,
      { fps: 30, durationMs: CAL_MS + 4000 },
    );

    const result = runOverheadPressSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'position-lost')).toBeGreaterThan(0);
  });

  it('does NOT fire position-lost on a clean continuous stream', () => {
    const frames = buildFrames(
      (): OverheadPressPoseIntent => ({ elbowFlexionDeg: RACKED_FLEX }),
      buildOverheadPressPose,
      { fps: 30, durationMs: 5000 },
    );

    const result = runOverheadPressSession(frames);
    expect(countWarnings(result, 'position-lost')).toBe(0);
  });

  it('does NOT fire position-lost during brief calibration nulls', () => {
    // Null frames during calibration (before confirmed) should not trigger
    const frames = buildFrames(
      (tMs) => {
        if (tMs < 1500) return null;  // null during cal
        return { elbowFlexionDeg: RACKED_FLEX } as OverheadPressPoseIntent;
      },
      buildOverheadPressPose,
      { fps: 30, durationMs: 3000 },
    );

    const result = runOverheadPressSession(frames);
    expect(countWarnings(result, 'position-lost')).toBe(0);
  });

  it('fires exactly once within 5s null window (10s cooldown respected)', () => {
    // 5 seconds of null post-cal → should fire exactly once at the 3s mark
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) return { elbowFlexionDeg: RACKED_FLEX } as OverheadPressPoseIntent;
        return null;
      },
      buildOverheadPressPose,
      { fps: 30, durationMs: CAL_MS + 5000 },
    );

    const result = runOverheadPressSession(frames);
    expect(countWarnings(result, 'position-lost')).toBe(1);
  });
});
