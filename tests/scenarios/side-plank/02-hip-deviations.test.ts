/**
 * Side Plank's body-line warnings — all recoverable per Fix S (freeze the
 * timer + warn, but do NOT terminate the hold).
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildSidePlankPose } from '../../harness/pose-stub';
import { runSidePlankSession, countWarnings } from '../../harness/runner';
import type { SidePlankPoseIntent } from '../../harness/types';

const CAL_MS = 2200;
const HOLD_START = CAL_MS;

describe('Side Plank — hip deviations (Fix S recoverable)', () => {
  it('fires hip-sag when the hips drop toward the floor', () => {
    const frames = buildFrames(
      (tMs): SidePlankPoseIntent => {
        const intoHold = tMs - HOLD_START;
        return { hipDelta: intoHold < 5000 ? 0 : 0.08 };
      },
      buildSidePlankPose,
      { fps: 30, durationMs: HOLD_START + 9000 },
    );
    const result = runSidePlankSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'hip-sag')).toBeGreaterThan(0);
    expect(result.broken).toBe(false);
  });

  it('fires hip-pike when the hips lift too high', () => {
    const frames = buildFrames(
      (tMs): SidePlankPoseIntent => {
        const intoHold = tMs - HOLD_START;
        return { hipDelta: intoHold < 5000 ? 0 : -0.08 };
      },
      buildSidePlankPose,
      { fps: 30, durationMs: HOLD_START + 9000 },
    );
    const result = runSidePlankSession(frames);
    expect(countWarnings(result, 'hip-pike')).toBeGreaterThan(0);
    expect(result.broken).toBe(false);
  });

  it('does NOT fire any deviation warning on a clean hold (sanity)', () => {
    const frames = buildFrames(
      () => ({ hipDelta: 0 } as SidePlankPoseIntent),
      buildSidePlankPose,
      { fps: 30, durationMs: HOLD_START + 8000 },
    );
    const result = runSidePlankSession(frames);
    expect(countWarnings(result, 'hip-sag')).toBe(0);
    expect(countWarnings(result, 'hip-pike')).toBe(0);
    expect(countWarnings(result, 'spine-misaligned')).toBe(0);
  });
});
