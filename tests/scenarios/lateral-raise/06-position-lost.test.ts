/**
 * Fix N — position-lost detection. If no usable pose frame for ≥ 3s
 * post-calibration, the engine emits `position-lost`. Repeats at most every
 * 10s while still lost.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildLateralRaisePose } from '../../harness/pose-stub';
import { runLateralRaiseSession, countWarnings } from '../../harness/runner';
import type { LateralRaisePoseIntent } from '../../harness/types';

const CAL_MS = 2200;

describe('Lateral Raise — position-lost warning (Fix N)', () => {
  it('fires position-lost after 3+ seconds of null landmarks post-calibration', () => {
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) return { abductionDeg: 0 } as LateralRaisePoseIntent;
        return null;
      },
      buildLateralRaisePose,
      { fps: 30, durationMs: CAL_MS + 4000 },
    );
    const result = runLateralRaiseSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'position-lost')).toBeGreaterThan(0);
  });

  it('does NOT fire position-lost on a clean continuous stream', () => {
    const frames = buildFrames(
      () => ({ abductionDeg: 0 } as LateralRaisePoseIntent),
      buildLateralRaisePose,
      { fps: 30, durationMs: 4000 },
    );
    const result = runLateralRaiseSession(frames);
    expect(countWarnings(result, 'position-lost')).toBe(0);
  });

  it('does NOT fire position-lost during the brief calibration phase', () => {
    const frames = buildFrames(
      (tMs) => {
        if (tMs < 1500) return null;
        return { abductionDeg: 0 } as LateralRaisePoseIntent;
      },
      buildLateralRaisePose,
      { fps: 30, durationMs: 3000 },
    );
    const result = runLateralRaiseSession(frames);
    expect(countWarnings(result, 'position-lost')).toBe(0);
  });

  it('does NOT re-fire position-lost within the 10s cooldown', () => {
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) return { abductionDeg: 0 } as LateralRaisePoseIntent;
        return null;
      },
      buildLateralRaisePose,
      { fps: 30, durationMs: CAL_MS + 5000 },
    );
    const result = runLateralRaiseSession(frames);
    expect(countWarnings(result, 'position-lost')).toBe(1);
  });
});
