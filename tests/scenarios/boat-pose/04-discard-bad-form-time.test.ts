/**
 * Fix B (wrong gets discarded) + Fix V (entry/exit hysteresis): sustained
 * bad-form periods freeze the accumulator. Final valid seconds < wall-clock.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildBoatPosePose } from '../../harness/pose-stub';
import { runBoatPoseSession, countWarnings } from '../../harness/runner';
import type { BoatPosePoseIntent } from '../../harness/types';

const CAL_MS = 2200;
const HOLD_START = CAL_MS;

describe('Boat Pose — bad-form time is discarded (Fix B + Fix V)', () => {
  it('freezes the hold counter during a sustained legs-dropped', () => {
    const frames = buildFrames(
      (tMs): BoatPosePoseIntent => {
        const intoHold = tMs - HOLD_START;
        // Clean 0-10s, legs sag 10-15s (chest stays up), clean again 15-20s.
        const leg = (intoHold >= 10_000 && intoHold < 15_000) ? 15 : 40;
        return { torsoAngleDeg: 45, legAngleDeg: leg };
      },
      buildBoatPosePose,
      { fps: 30, durationMs: HOLD_START + 20_000 },
    );
    const result = runBoatPoseSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.broken).toBe(false);
    expect(countWarnings(result, 'legs-dropped')).toBeGreaterThan(0);

    const lastTick = result.holdTicks[result.holdTicks.length - 1];
    // ~22s of hold with ~5s frozen → ~17s valid.
    expect(lastTick.secondsElapsed).toBeLessThanOrEqual(18);
    expect(lastTick.secondsElapsed).toBeGreaterThanOrEqual(12);
  });

  it('does NOT freeze on single-frame jitter (Fix V hysteresis)', () => {
    const frames = buildFrames(
      (tMs): BoatPosePoseIntent => {
        const intoHold = tMs - HOLD_START;
        const isBadFrame = intoHold > 0 && Math.floor(intoHold / 33) % 30 === 0;
        return { torsoAngleDeg: 45, legAngleDeg: isBadFrame ? 15 : 40 };
      },
      buildBoatPosePose,
      { fps: 30, durationMs: HOLD_START + 10_000 },
    );
    const result = runBoatPoseSession(frames);
    expect(countWarnings(result, 'legs-dropped')).toBe(0);
    const lastTick = result.holdTicks[result.holdTicks.length - 1];
    expect(lastTick.secondsElapsed).toBeGreaterThanOrEqual(9);
  });
});
