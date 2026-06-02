/**
 * Hold-broken: the ONLY terminal condition is the inverted V fully collapsing
 * (apex angle past APEX_BROKEN = 150, e.g. dropping to a flat line or standing
 * up). Hip-sag short of that is recoverable and only freezes the timer.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildDownwardDogPose } from '../../harness/pose-stub';
import { runDownwardDogSession } from '../../harness/runner';
import type { DownwardDogPoseIntent } from '../../harness/types';

const CAL_MS = 1000;

describe('Downward Dog — hold broken', () => {
  it('ends the hold when the inverted V fully collapses (flat)', () => {
    const frames = buildFrames(
      (tMs): DownwardDogPoseIntent => tMs < CAL_MS
        ? { apexAngleDeg: 90, side: 'left' }
        : { apexAngleDeg: 168, side: 'left' },
      buildDownwardDogPose,
      { fps: 30, durationMs: CAL_MS + 3000 },
    );
    const result = runDownwardDogSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.broken).toBe(true);
  });

  it('does NOT end the hold while the V stays sharp', () => {
    const frames = buildFrames(
      (): DownwardDogPoseIntent => ({ apexAngleDeg: 95, side: 'left' }),
      buildDownwardDogPose,
      { fps: 30, durationMs: CAL_MS + 8000 },
    );
    const result = runDownwardDogSession(frames);
    expect(result.broken).toBe(false);
  });
});
