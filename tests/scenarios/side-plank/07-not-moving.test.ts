/**
 * Idle `not-moving` prompt for Side Plank: fires when form has been broken (hips
 * collapsed) for ≥ 5 s; does not fire on a clean hold.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildSidePlankPose } from '../../harness/pose-stub';
import { runSidePlankSession, countWarnings } from '../../harness/runner';
import type { SidePlankPoseIntent } from '../../harness/types';

const CAL_MS = 2200;
const HOLD_START = CAL_MS;

describe('Side Plank — not-moving idle prompt', () => {
  it('fires not-moving after ~5 s of sustained form-break (hips sagging)', () => {
    const frames = buildFrames(
      (tMs): SidePlankPoseIntent => {
        const intoHold = tMs - HOLD_START;
        return { hipDelta: intoHold < 1000 ? 0 : 0.10 };
      },
      buildSidePlankPose,
      { fps: 30, durationMs: HOLD_START + 10_000 },
    );
    const result = runSidePlankSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'not-moving')).toBeGreaterThan(0);
  });

  it('does NOT fire not-moving on a clean hold', () => {
    const frames = buildFrames(
      () => ({ hipDelta: 0 } as SidePlankPoseIntent),
      buildSidePlankPose,
      { fps: 30, durationMs: HOLD_START + 10_000 },
    );
    const result = runSidePlankSession(frames);
    expect(countWarnings(result, 'not-moving')).toBe(0);
  });
});
