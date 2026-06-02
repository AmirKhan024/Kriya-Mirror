/**
 * Fix S split — only the user sitting/standing up (shoulder rise ≥ 18%)
 * terminates the hold. A hip sag freezes the timer but doesn't terminate.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildSidePlankPose } from '../../harness/pose-stub';
import { runSidePlankSession, countWarnings } from '../../harness/runner';
import type { SidePlankPoseIntent } from '../../harness/types';

const CAL_MS = 2200;
const HOLD_START = CAL_MS;

describe('Side Plank — hold-broken (Fix S terminal split)', () => {
  it('terminates ONCE when the user sits up (shoulder rise ≥ 18%)', () => {
    const frames = buildFrames(
      (tMs): SidePlankPoseIntent => {
        const intoHold = tMs - HOLD_START;
        return { hipDelta: 0, shoulderRise: intoHold < 4000 ? 0 : 0.24 };
      },
      buildSidePlankPose,
      { fps: 30, durationMs: HOLD_START + 8000 },
    );
    const result = runSidePlankSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.broken).toBe(true);
    expect(result.brokenAtMs).not.toBeNull();
    expect(countWarnings(result, 'hold-broken')).toBeGreaterThanOrEqual(1);
  });

  it('does NOT terminate on a brief shoulder-rise wobble (< debounce window)', () => {
    const frames = buildFrames(
      (tMs): SidePlankPoseIntent => {
        const intoHold = tMs - HOLD_START;
        // A ~250 ms wobble (≈ 8 frames < 12-frame debounce) then settle back.
        const wobble = intoHold >= 3000 && intoHold < 3250;
        return { hipDelta: 0, shoulderRise: wobble ? 0.24 : 0 };
      },
      buildSidePlankPose,
      { fps: 30, durationMs: HOLD_START + 8000 },
    );
    const result = runSidePlankSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.broken).toBe(false);
    expect(countWarnings(result, 'hold-broken')).toBe(0);
  });

  it('does NOT terminate on hip-sag alone (Fix S recoverable)', () => {
    const frames = buildFrames(
      (tMs): SidePlankPoseIntent => {
        const intoHold = tMs - HOLD_START;
        return { hipDelta: intoHold < 3000 ? 0 : 0.08 };
      },
      buildSidePlankPose,
      { fps: 30, durationMs: HOLD_START + 8000 },
    );
    const result = runSidePlankSession(frames);
    expect(result.broken).toBe(false);
    expect(countWarnings(result, 'hip-sag')).toBeGreaterThan(0);
    expect(countWarnings(result, 'hold-broken')).toBe(0);
  });
});
