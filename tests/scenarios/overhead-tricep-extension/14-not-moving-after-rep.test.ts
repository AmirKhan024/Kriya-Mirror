import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildOTEPose } from '../../harness/pose-stub';
import { runOTESession, countWarnings } from '../../harness/runner';

/**
 * Fix O regression: after a rep completes and the user returns to EXTENDED,
 * the EMA-smoothed metric decays exponentially from its mid-rep value back to
 * the true resting level. Without the reseed fix, this decay tail permanently
 * inflates `max - min` in the variance check, blocking `not-moving` from ever
 * firing again after a rep + rest period.
 */
describe('Overhead Tricep Extension — not-moving after rep (Fix O)', () => {
  it('fires not-moving after doing a rep then idling for 8s', () => {
    const calMs = 2200;
    // One rep (3s) then idle for 9s
    const frames = buildFrames(
      (t) => {
        if (t < calMs) return { extensionLevel: 1.0 };
        const tRep = t - calMs;
        if (tRep < 1500) return { extensionLevel: 1.0 - (tRep / 1500) };
        if (tRep < 2000) return { extensionLevel: 0.0 };
        if (tRep < 3000) return { extensionLevel: (tRep - 2000) / 1000 };
        // Now idling in EXTENDED for 9 more seconds
        return { extensionLevel: 1.0 };
      },
      buildOTEPose,
      { fps: 30, durationMs: calMs + 3000 + 9000 },
    );

    const result = runOTESession(frames);

    expect(result.completedReps.length).toBe(1);
    // not-moving must fire during the post-rep idle period
    const nmWarnings = result.warnings.filter((w) => w.type === 'not-moving');
    expect(nmWarnings.length).toBeGreaterThanOrEqual(1);
    // Should fire at or after: cal + rep + 5s idle = 2200 + 3000 + 5000 = 10200ms
    expect(nmWarnings[0].atMs).toBeGreaterThan(calMs + 3000);
  });
});
