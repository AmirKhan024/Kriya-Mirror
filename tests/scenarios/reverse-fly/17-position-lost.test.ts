/**
 * Reverse Fly — position-lost warning (Fix N).
 * Fires when no usable pose for ≥ 3s post-calibration.
 * Cooldown: repeats at most every 10s.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildReverseFlyPose } from '../../harness/pose-stub';
import { runReverseFlySession, countWarnings } from '../../harness/runner';

const CAL_MS = 300;

describe('Reverse Fly — position-lost warning (Fix N)', () => {
  it('fires position-lost after 3+ seconds of null landmarks post-calibration', () => {
    // Calibrate for 300ms, then null landmarks for 4s.
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) return { armLiftDeg: 0, bentOver: true };
        return null;
      },
      buildReverseFlyPose,
      { fps: 30, durationMs: CAL_MS + 4000 },
    );

    const result = runReverseFlySession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'position-lost')).toBeGreaterThan(0);
  });

  it('does NOT fire position-lost on a clean continuous stream', () => {
    // Arms at rest the entire time — no position loss.
    const frames = buildFrames(
      () => ({ armLiftDeg: 0, bentOver: true }),
      buildReverseFlyPose,
      { fps: 30, durationMs: 4000 },
    );

    const result = runReverseFlySession(frames);
    expect(countWarnings(result, 'position-lost')).toBe(0);
  });

  it('does NOT fire position-lost during calibration phase (before confirmed)', () => {
    // Null frames before calibration has confirmed — should not fire position-lost.
    const frames = buildFrames(
      (tMs) => {
        if (tMs < 1500) return null;
        return { armLiftDeg: 0, bentOver: true };
      },
      buildReverseFlyPose,
      { fps: 30, durationMs: 3000 },
    );

    const result = runReverseFlySession(frames);
    expect(countWarnings(result, 'position-lost')).toBe(0);
  });

  it('does NOT re-fire position-lost within the 10s cooldown', () => {
    // 5s of null post-cal — should fire exactly once at ~3s, then not again before 10s.
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) return { armLiftDeg: 0, bentOver: true };
        return null;
      },
      buildReverseFlyPose,
      { fps: 30, durationMs: CAL_MS + 5000 },
    );

    const result = runReverseFlySession(frames);
    expect(countWarnings(result, 'position-lost')).toBe(1);
  });
});
