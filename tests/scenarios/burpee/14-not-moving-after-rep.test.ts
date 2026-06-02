/**
 * Burpee — not-moving fires after a real rep + idle (Fix O regression).
 *
 * After completing a burpee, if the user stands still for 5+ seconds,
 * the not-moving warning must fire. The EMA-decay reseed (Fix O) ensures
 * the idle accumulator resets properly after the rep's EMA tail settles.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildBurpeePose } from '../../harness/pose-stub';
import { runBurpeeSession, countWarnings } from '../../harness/runner';
import type { BurpeePoseIntent } from '../../harness/types';

const CAL_MS = 500;
const REP_MS = 2000;

describe('Burpee — regression: not-moving fires after a real rep + idle (Fix O)', () => {
  it('fires not-moving after one completed rep then 8 seconds of idle', () => {
    const IDLE_MS = 8000;
    const totalMs = CAL_MS + REP_MS + IDLE_MS;

    const frames = buildFrames(
      (tMs): BurpeePoseIntent => {
        if (tMs < CAL_MS) {
          return { hipYOffset: 0, kneeAngleDeg: 170, bodyHeight: 0.62 };
        }
        const tInRep = tMs - CAL_MS;
        if (tInRep < REP_MS) {
          // Full burpee rep
          if (tInRep < 300) {
            const frac = tInRep / 300;
            return { hipYOffset: frac * 0.05, kneeAngleDeg: 170 - frac * 80, bodyHeight: 0.62 };
          } else if (tInRep < 600) {
            const frac = (tInRep - 300) / 300;
            return { hipYOffset: 0.05 + frac * 0.12, kneeAngleDeg: 90 + frac * 80, bodyHeight: 0.62 };
          } else if (tInRep < 900) {
            return { hipYOffset: 0.17, kneeAngleDeg: 170, bodyHeight: 0.62 };
          } else if (tInRep < 1200) {
            const frac = (tInRep - 900) / 300;
            return { hipYOffset: 0.17 - frac * 0.15, kneeAngleDeg: 170, bodyHeight: 0.62 };
          } else if (tInRep < 1500) {
            const frac = (tInRep - 1200) / 300;
            return { hipYOffset: -0.06 * Math.sin(frac * Math.PI), kneeAngleDeg: 170, bodyHeight: 0.62 };
          } else {
            return { hipYOffset: 0, kneeAngleDeg: 170, bodyHeight: 0.62 };
          }
        }
        // Post-rep idle — stand still
        return { hipYOffset: 0, kneeAngleDeg: 170, bodyHeight: 0.62 };
      },
      buildBurpeePose,
      { fps: 30, durationMs: totalMs },
    );

    const result = runBurpeeSession(frames);

    expect(result.finalCalibration?.state).toBe('confirmed');
    // Should count the rep
    expect(result.completedReps.length).toBe(1);
    // Critical: not-moving must fire during the 8s idle post-rep
    expect(countWarnings(result, 'not-moving')).toBeGreaterThanOrEqual(1);
  });
});
