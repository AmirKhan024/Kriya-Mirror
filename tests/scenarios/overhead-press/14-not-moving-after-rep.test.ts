/**
 * Overhead Press — regression: not-moving must fire after a real rep + idle
 * (Fix O: EMA-decay reseed after return to RACKED).
 *
 * Same bug pattern as bicep-curl round-7: post-rep EMA-decay tail (smoothedFlex
 * drifting from ~12° back toward resting ~75° over several seconds) permanently
 * inflates max - min in the RACKED window, so variance never closes below 2°.
 *
 * Fix: once smoothedFlex per-frame delta < 0.3° for 500ms, reseed the min/max
 * accumulators so idle counting restarts from the settled value.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildOverheadPressPose } from '../../harness/pose-stub';
import { runOverheadPressSession, countWarnings } from '../../harness/runner';
import type { OverheadPressPoseIntent } from '../../harness/types';

const CAL_MS = 800;
const RACKED_FLEX = 75;
const LOCKED_FLEX = 12;

describe('Overhead Press — regression: not-moving fires after rep + idle (Fix O)', () => {
  it('fires not-moving after 1 rep then 8s idle in RACKED state', () => {
    // Profile: calibrate → one press rep (2.5s) → 8s idle.
    const REP_END_MS = CAL_MS + 2500;
    const TOTAL_MS = REP_END_MS + 8000;

    const frames = buildFrames(
      (tMs): OverheadPressPoseIntent => {
        if (tMs < CAL_MS) return { elbowFlexionDeg: RACKED_FLEX };
        if (tMs < REP_END_MS) {
          const tInRep = tMs - CAL_MS;
          let flex: number;
          if (tInRep < 200)      flex = RACKED_FLEX;
          else if (tInRep < 1200) flex = RACKED_FLEX - ((tInRep - 200) / 1000) * (RACKED_FLEX - LOCKED_FLEX);
          else if (tInRep < 1500) flex = LOCKED_FLEX;
          else                    flex = LOCKED_FLEX + ((tInRep - 1500) / 1000) * (RACKED_FLEX - LOCKED_FLEX);
          return { elbowFlexionDeg: flex };
        }
        // Post-rep idle at racked position
        return { elbowFlexionDeg: RACKED_FLEX };
      },
      buildOverheadPressPose,
      { fps: 30, durationMs: TOTAL_MS },
    );

    const result = runOverheadPressSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'not-moving')).toBeGreaterThanOrEqual(1);
  });
});
