/**
 * Reverse Fly — not-moving fires after a real rep + idle (Fix O regression).
 *
 * The post-rep EMA decay tail causes smoothedLift to drift for several
 * seconds, inflating the variance accumulator permanently. Fix O: once the EMA
 * has settled (per-frame delta < 0.5° for 500ms), reseed the min/max from the
 * current value so only true jitter counts toward variance.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildReverseFlyPose } from '../../harness/pose-stub';
import { runReverseFlySession, countWarnings } from '../../harness/runner';

const CAL_MS = 300;

describe('Reverse Fly — regression: not-moving fires after a real rep + idle (Fix O)', () => {
  it('DOES fire not-moving when user rests after completing a reverse fly rep', () => {
    // Profile: calibrate 300ms → one full fly rep (0→70→0 over 3s) → 8s idle.
    // Total = 0.3 + 3 + 8 = 11.3s.
    const REP_END_MS = CAL_MS + 3000;
    const TOTAL_MS = REP_END_MS + 8000;

    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) return { armLiftDeg: 0, bentOver: true };
        if (tMs < REP_END_MS) {
          const tInRep = tMs - CAL_MS;
          let liftDeg: number;
          if (tInRep < 1000)      liftDeg = (tInRep / 1000) * 70;
          else if (tInRep < 1500) liftDeg = 70;
          else if (tInRep < 2500) liftDeg = 70 - ((tInRep - 1500) / 1000) * 70;
          else                    liftDeg = 0;
          return { armLiftDeg: liftDeg, bentOver: true };
        }
        // Post-rep idle: arms hanging, no motion.
        return { armLiftDeg: 0, bentOver: true };
      },
      buildReverseFlyPose,
      { fps: 30, durationMs: TOTAL_MS },
    );

    const result = runReverseFlySession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    // At least one rep must have been counted (confirms the rep phase ran)
    expect(result.completedReps.length).toBeGreaterThanOrEqual(1);
    // The main assertion: not-moving must fire post-rep.
    expect(countWarnings(result, 'not-moving')).toBeGreaterThanOrEqual(1);
  });
});
