/**
 * Regression test for Fix O on Jumping Jacks: idle `not-moving` warning must
 * fire after a real rep, not just from cold-start CLOSED.
 *
 * Bug pattern (same as calf-raise / bicep-curl / lunge round-7): the post-rep
 * EMA-decay tail (smoothedCompositePct drifting from ~50 down to ~15 over
 * several seconds) permanently inflates max − min, so the variance accumulator
 * never closes back below NO_MOVEMENT_VARIANCE_PCT.
 *
 * Fix (engine.ts): once smoothedCompositePct has settled (per-frame Δ < 0.5
 * for 500 ms), drop the cached min/max and reseed.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildJumpingJacksPose } from '../../harness/pose-stub';
import { runJumpingJacksSession, countWarnings } from '../../harness/runner';
import type { JumpingJacksPoseIntent } from '../../harness/types';

const CAL_MS = 2200;

describe('Jumping Jacks — regression: not-moving fires after a real rep + idle', () => {
  it('DOES fire not-moving when user rests in CLOSED after completing a rep', () => {
    // Profile: CLOSED during cal → one full jack (composite 0 → 100 → 0 over
    // 2.0 s) → 8 s of CLOSED idle. Total = 2.2 + 2.0 + 8 = 12.2 s.
    const REP_END_MS = CAL_MS + 2000;
    const TOTAL_MS = REP_END_MS + 8000;
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) {
          return { armOpennessPct: 0, legOpennessPct: 30 } as JumpingJacksPoseIntent;
        }
        if (tMs < REP_END_MS) {
          const tInRep = tMs - CAL_MS;
          let arm: number, leg: number;
          if (tInRep < 500) { arm = (tInRep / 500) * 100; leg = 30 + (tInRep / 500) * 70; }
          else if (tInRep < 1000) { arm = 100; leg = 100; }
          else if (tInRep < 1500) { arm = 100 - ((tInRep - 1000) / 500) * 100; leg = 100 - ((tInRep - 1000) / 500) * 70; }
          else { arm = 0; leg = 30; }
          return { armOpennessPct: arm, legOpennessPct: leg } as JumpingJacksPoseIntent;
        }
        // Post-rep idle: back to CLOSED stance.
        return { armOpennessPct: 0, legOpennessPct: 30 } as JumpingJacksPoseIntent;
      },
      buildJumpingJacksPose,
      { fps: 30, durationMs: TOTAL_MS },
    );

    const result = runJumpingJacksSession(frames);

    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThan(500);
    expect(countWarnings(result, 'not-moving')).toBeGreaterThanOrEqual(1);
  });
});
