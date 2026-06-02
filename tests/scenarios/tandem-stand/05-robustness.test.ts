import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildTandemStandPose } from '../../harness/pose-stub';
import { runTandemStandSession, warningsOtherThan } from '../../harness/runner';
import type { TandemStandPoseIntent } from '../../harness/types';

const CAL_MS = 2200;

function holdSession(fps: number, extras: Partial<TandemStandPoseIntent> = {}) {
  return buildFrames(
    () => ({ tandemAhead: 'left' as const, ...extras }),
    buildTandemStandPose,
    { fps, durationMs: CAL_MS + 10_000 },
  );
}

describe('Tandem Stand — frame-rate invariance', () => {
  it('confirms calibration + completes hold at 30fps and 60fps', () => {
    const r30 = runTandemStandSession(holdSession(30));
    const r60 = runTandemStandSession(holdSession(60));
    expect(r30.finalCalibration?.state).toBe('confirmed');
    expect(r60.finalCalibration?.state).toBe('confirmed');
    expect(r30.broken).toBe(false);
    expect(r60.broken).toBe(false);
  });

  it('handles low fps (15fps)', () => {
    const r15 = runTandemStandSession(holdSession(15));
    expect(r15.finalCalibration?.state).toBe('confirmed');
    expect(r15.broken).toBe(false);
  });
});

describe('Tandem Stand — noise tolerance', () => {
  it('does NOT false-fire on mild gaussian noise (σ=0.004)', () => {
    // Sway threshold is clinical (6°). Mild landmark jitter should not trip it
    // because EMA smoothing damps frame-to-frame noise.
    const result = runTandemStandSession(holdSession(30, { noise: 0.004, seed: 23 }));
    // Allow up to 2 spurious warnings across the 10-second hold.
    expect(warningsOtherThan(result).length).toBeLessThanOrEqual(2);
  });

  it('still counts the hold as a hold (not broken) under mild noise', () => {
    const result = runTandemStandSession(holdSession(30, { noise: 0.004, seed: 23 }));
    expect(result.broken).toBe(false);
  });
});
