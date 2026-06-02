import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildStarPosePose } from '../../harness/pose-stub';
import { runStarPoseSession, countWarnings } from '../../harness/runner';

const CAL_MS = 2200;

describe('Star Pose — hold broken', () => {
  it('does NOT end the hold when the extended leg lowers — fires foot-dropped (recoverable)', () => {
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS + 3000) return { liftedSide: 'left' as const };
        return { liftedSide: 'left' as const, liftElevation: 0 };
      },
      buildStarPosePose,
      { fps: 30, durationMs: CAL_MS + 6000 },
    );
    const result = runStarPoseSession(frames);
    expect(result.broken).toBe(false);
    expect(countWarnings(result, 'foot-dropped')).toBeGreaterThan(0);
  });

  it('fires hold-broken when the user stands up (shoulder rise > 15%)', () => {
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS + 3000) return { liftedSide: 'left' as const };
        return { liftedSide: 'left' as const, shoulderRise: 0.20 };
      },
      buildStarPosePose,
      { fps: 30, durationMs: CAL_MS + 6000 },
    );
    const result = runStarPoseSession(frames);
    expect(result.broken).toBe(true);
  });

  it('does NOT fire hold-broken on a clean steady hold', () => {
    const frames = buildFrames(
      () => ({ liftedSide: 'left' as const }),
      buildStarPosePose,
      { fps: 30, durationMs: CAL_MS + 10_000 },
    );
    const result = runStarPoseSession(frames);
    expect(result.broken).toBe(false);
  });
});
