/**
 * Regression test for Fix O on Front Raise: idle `not-moving` warning must
 * fire after a real rep, not just from cold-start DOWN.
 *
 * Bug pattern: post-rep EMA-decay tail (smoothedFlexion drifting from ~20°
 * down to ~0° over several seconds) permanently inflates max − min, so the
 * variance accumulator never closes back below NO_MOVEMENT_VARIANCE_DEG.
 *
 * Fix (engine.ts): once smoothedFlexion has settled (per-frame Δ < 0.3° for
 * 500 ms), drop the cached min/max and reseed.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildFrontRaisePose } from '../../harness/pose-stub';
import { runFrontRaiseSession, countWarnings } from '../../harness/runner';
import type { FrontRaisePoseIntent } from '../../harness/types';

const CAL_MS = 2200;

describe('Front Raise — regression: not-moving fires after a real rep + idle', () => {
  it('DOES fire not-moving when user rests in DOWN after completing a rep', () => {
    // Profile: DOWN during cal → one full front raise (0 → 100 → 0 over 2.5 s)
    // → 8 s of DOWN idle. Total = 2.2 + 2.5 + 8 = 12.7 s.
    const REP_END_MS = CAL_MS + 2500;
    const TOTAL_MS = REP_END_MS + 8000;
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) {
          return { shoulderFlexionDeg: 0 } as FrontRaisePoseIntent;
        }
        if (tMs < REP_END_MS) {
          const tInRep = tMs - CAL_MS;
          let flex: number;
          if (tInRep < 800) flex = (tInRep / 800) * 95;
          else if (tInRep < 1300) flex = 95;
          else flex = Math.max(0, 95 - ((tInRep - 1300) / 1200) * 95);
          return { shoulderFlexionDeg: flex } as FrontRaisePoseIntent;
        }
        return { shoulderFlexionDeg: 0 } as FrontRaisePoseIntent;
      },
      buildFrontRaisePose,
      { fps: 30, durationMs: TOTAL_MS },
    );

    const result = runFrontRaiseSession(frames);

    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThan(500);
    expect(countWarnings(result, 'not-moving')).toBeGreaterThanOrEqual(1);
  });
});
