/**
 * Fix O — the idle `not-moving` warning must fire after a REAL swing, not just
 * from cold start (the post-rep EMA-decay reseed prevents the abduction decay
 * tail from permanently suppressing the variance gate).
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildSideLegRaisePose } from '../../harness/pose-stub';
import { runStandingLegSwingSession, countWarnings } from '../../harness/runner';
import type { SideLegRaisePoseIntent } from '../../harness/types';

const CAL_MS = 2200;

describe('Standing Leg Swing — not-moving fires after a real swing + idle (Fix O)', () => {
  it('DOES fire not-moving when the user rests after completing a swing', () => {
    const REP_END_MS = CAL_MS + 1600;
    const TOTAL_MS = REP_END_MS + 8000;
    const frames = buildFrames(
      (tMs): SideLegRaisePoseIntent => {
        if (tMs < CAL_MS) return { leftAbductionDeg: 0, rightAbductionDeg: 0 };
        if (tMs < REP_END_MS) {
          const t = tMs - CAL_MS;
          let abd = 0;
          if (t < 600) abd = (t / 600) * 35;
          else if (t < 900) abd = 35;
          else abd = 35 - ((t - 900) / 600) * 35;
          if (abd < 0) abd = 0;
          return { leftAbductionDeg: abd, rightAbductionDeg: 0 };
        }
        return { leftAbductionDeg: 0, rightAbductionDeg: 0 };
      },
      buildSideLegRaisePose,
      { fps: 30, durationMs: TOTAL_MS },
    );

    const result = runStandingLegSwingSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.completedReps.length).toBe(1);
    expect(countWarnings(result, 'not-moving')).toBeGreaterThanOrEqual(1);
  });
});
