/**
 * Regression test for the calibration thrash bug surfaced by Amir's
 * 2026-05-25 round-3 physical-test logs. The `dist` gate flipped between
 * true/false at least 9 times across ~25 seconds, repeatedly resetting the
 * 2-second confirmation timer.
 *
 * Fix: add a hysteresis band — once the distance gate satisfies the stricter
 * ENTER thresholds, the wider EXIT thresholds keep it satisfied through small
 * frame-to-frame jitter. The gate only re-fails if the user actually moves
 * significantly out of range.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildPlankPose } from '../../harness/pose-stub';
import { runPlankSession } from '../../harness/runner';

describe('Plank — calibration distance gate hysteresis (round 4)', () => {
  it('confirms even when bodyLengthX oscillates across the ENTER threshold', () => {
    // Oscillate between 0.47 (just above MIN_ENTER=0.45) and 0.43 (just
    // below MIN_ENTER). Each phase lasts 500ms — longer than the 300ms
    // bad-posture buffer, so pre-fix this would reset goodPostureStart on
    // every cycle and never confirm.
    const frames = buildFrames(
      (tMs) => {
        const phase = Math.floor(tMs / 500) % 2;
        const bodyLengthX = phase === 0 ? 0.47 : 0.43;
        return { hipDelta: 0, side: 'left' as const, bodyLengthX };
      },
      buildPlankPose,
      { fps: 30, durationMs: 6000 },
    );
    const result = runPlankSession(frames);
    // With hysteresis: once 0.47 frames satisfy MIN_ENTER, 0.43 frames
    // still satisfy MIN_EXIT=0.40, so distanceOk stays true. Confirms
    // within ~2.5s.
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).not.toBeNull();
    expect(result.calibrationConfirmedAtMs!).toBeLessThan(3500);
  });

  it('still rejects when bodyLengthX falls clearly below the EXIT threshold', () => {
    // Confirm hysteresis isn't too forgiving — a clearly-too-far body
    // (0.35, below even MIN_EXIT=0.40) must still fail.
    const frames = buildFrames(
      () => ({ hipDelta: 0, side: 'left' as const, bodyLengthX: 0.35 }),
      buildPlankPose,
      { fps: 30, durationMs: 3000 },
    );
    const result = runPlankSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.distanceHint).toBe('too-far');
  });

  it('still rejects when bodyLengthX clearly exceeds the EXIT threshold', () => {
    // Same direction sanity check for too-close (above MAX_EXIT=1.00).
    const frames = buildFrames(
      () => ({ hipDelta: 0, side: 'left' as const, bodyLengthX: 1.05 }),
      buildPlankPose,
      { fps: 30, durationMs: 3000 },
    );
    const result = runPlankSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.distanceHint).toBe('too-close');
  });
});
