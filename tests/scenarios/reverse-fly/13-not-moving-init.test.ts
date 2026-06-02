/**
 * Reverse Fly — not-moving fires on initial idle after calibration (Fix I + Fix P).
 * Idle tracking is seeded on cal-confirm. First not-moving fires at 5s.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildReverseFlyPose } from '../../harness/pose-stub';
import { runReverseFlySession, countWarnings } from '../../harness/runner';

const CAL_MS = 300;

describe('Reverse Fly — not-moving fires on initial idle (Fix I + Fix P)', () => {
  it('not-moving fires at ~5s idle after calibration confirm', () => {
    // Calibrate for 300ms, then stay still for 6s. Should fire not-moving.
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) return { armLiftDeg: 0, bentOver: true };
        return { armLiftDeg: 0, bentOver: true };  // idle in DOWN state
      },
      buildReverseFlyPose,
      { fps: 30, durationMs: CAL_MS + 6000 },
    );

    const result = runReverseFlySession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'not-moving')).toBeGreaterThanOrEqual(1);
  });

  it('not-moving does NOT fire within the first 4s of idle', () => {
    // 4s idle — should NOT fire (timeout is 5s)
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) return { armLiftDeg: 0, bentOver: true };
        return { armLiftDeg: 0, bentOver: true };
      },
      buildReverseFlyPose,
      { fps: 30, durationMs: CAL_MS + 4000 },
    );

    const result = runReverseFlySession(frames);
    expect(countWarnings(result, 'not-moving')).toBe(0);
  });

  it('not-moving fires only ONCE within the 15s repeat cooldown', () => {
    // 5s+8s of idle — should fire exactly once (cooldown = 15s)
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) return { armLiftDeg: 0, bentOver: true };
        return { armLiftDeg: 0, bentOver: true };
      },
      buildReverseFlyPose,
      { fps: 30, durationMs: CAL_MS + 13000 },
    );

    const result = runReverseFlySession(frames);
    // Should fire at ~5s and then not again until 15s (total = 20s), so only 1 fire in 13s
    expect(countWarnings(result, 'not-moving')).toBe(1);
  });
});
