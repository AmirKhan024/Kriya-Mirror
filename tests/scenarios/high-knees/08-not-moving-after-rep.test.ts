/**
 * Regression test for Fix O on High Knees: idle `not-moving` warning must
 * fire after real reps, not just from cold-start BOTH_DOWN.
 *
 * Bug pattern: post-rep EMA-decay tail (smoothed lifts drifting from ~30
 * down to ~0 over several seconds) permanently inflates max − min, so the
 * variance accumulator never closes back below NO_MOVEMENT_VARIANCE_PCT.
 *
 * Fix (engine.ts): once both per-side smoothed lifts have settled (per-frame
 * Δ < SETTLED_DELTA_PCT for SETTLED_HOLD_MS), drop the cached min/max and
 * reseed.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildHighKneesPose } from '../../harness/pose-stub';
import { runHighKneesSession, countWarnings } from '../../harness/runner';
import type { HighKneesPoseIntent } from '../../harness/types';

const CAL_MS = 2200;

describe('High Knees — regression: not-moving fires after a rep burst + idle', () => {
  it('DOES fire not-moving when user rests in BOTH_DOWN after a few alternating reps', () => {
    // Profile: BOTH_DOWN during cal → 2-second burst of alternating high knees
    // → 8 s of BOTH_DOWN idle. Total = 2.2 + 2.0 + 8 = 12.2 s.
    const BURST_MS = 2000;
    const REP_END_MS = CAL_MS + BURST_MS;
    const TOTAL_MS = REP_END_MS + 8000;
    const cycleMs = 1000;
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) {
          return { leftKneeLiftPct: 0, rightKneeLiftPct: 0 } as HighKneesPoseIntent;
        }
        if (tMs < REP_END_MS) {
          const tInCycle = (tMs - CAL_MS) % cycleMs;
          let left: number, right: number;
          if (tInCycle < 300) { left = (tInCycle / 300) * 70; right = 0; }
          else if (tInCycle < 500) { left = 70; right = 0; }
          else if (tInCycle < 700) {
            const u = (tInCycle - 500) / 200;
            left = 70 * (1 - u); right = 70 * u;
          }
          else if (tInCycle < 900) { left = 0; right = 70; }
          else { left = 0; right = 70 * (1 - (tInCycle - 900) / 100); }
          return { leftKneeLiftPct: left, rightKneeLiftPct: right } as HighKneesPoseIntent;
        }
        // Post-burst idle: back to BOTH_DOWN.
        return { leftKneeLiftPct: 0, rightKneeLiftPct: 0 } as HighKneesPoseIntent;
      },
      buildHighKneesPose,
      { fps: 30, durationMs: TOTAL_MS },
    );

    const result = runHighKneesSession(frames);

    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'not-moving')).toBeGreaterThanOrEqual(1);
  });
});
