import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildSingleLegStandPose } from '../../harness/pose-stub';
import { runSingleLegStandSession, countWarnings } from '../../harness/runner';

const CAL_MS = 2200;

describe('Single Leg Stand — hold broken', () => {
  it('does NOT end the hold when the lifted foot returns to the floor — fires foot-dropped warning (round 11)', () => {
    // 2026-05-25 round 11: foot-dropped is now a RECOVERABLE form warning,
    // no longer a hold-broken trigger. The user can lift their leg back up.
    // After 3 seconds of hold, the lifted ankle's elevation drops to 0.01
    // (below FOOT_DROPPED_RATIO=0.10 × shoulderWidth=0.16 → 0.016 threshold).
    // Warning fires, hold continues. Only shoulder-rise still terminates.
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS + 3000) return { liftedSide: 'left' as const };
        return { liftedSide: 'left' as const, liftElevation: 0.01 };
      },
      buildSingleLegStandPose,
      { fps: 30, durationMs: CAL_MS + 6000 },
    );
    const result = runSingleLegStandSession(frames);
    expect(result.broken).toBe(false);
    expect(countWarnings(result, 'foot-dropped')).toBeGreaterThan(0);
  });

  it('fires hold-broken when the user stands down (shoulder rise > 15%)', () => {
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS + 3000) return { liftedSide: 'left' as const };
        return { liftedSide: 'left' as const, shoulderRise: 0.20 };
      },
      buildSingleLegStandPose,
      { fps: 30, durationMs: CAL_MS + 6000 },
    );
    const result = runSingleLegStandSession(frames);
    expect(result.broken).toBe(true);
  });

  it('does NOT fire hold-broken on a clean steady hold', () => {
    const frames = buildFrames(
      () => ({ liftedSide: 'left' as const }),
      buildSingleLegStandPose,
      { fps: 30, durationMs: CAL_MS + 10_000 },
    );
    const result = runSingleLegStandSession(frames);
    expect(result.broken).toBe(false);
  });
});
