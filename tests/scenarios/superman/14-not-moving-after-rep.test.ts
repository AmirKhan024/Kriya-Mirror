/**
 * Regression test for Superman Fix O — EMA decay reseed.
 *
 * After a real rep the smoothed shoulder-rise metric drifts from ~0.08 toward
 * 0 over several seconds. While decaying, max−min stays large, permanently
 * inflating the variance accumulator and potentially blocking 'not-moving'.
 *
 * Fix O: once the per-frame EMA shift has settled, re-baseline min/max so
 * the variance window reflects only true post-settle jitter.
 *
 * Profile:
 *   0 – CAL_MS          : calibration (prone, armsForward)
 *   CAL_MS – REP_END_MS : one full rep (rise 0 → 0.08 → 0 over 2.5 s)
 *   REP_END_MS – END    : 8 s of prone idle → must fire 'not-moving'
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildSupermanPose } from '../../harness/pose-stub';
import { runSupermanSession, countWarnings } from '../../harness/runner';
import type { SupermanPoseIntent } from '../../harness/types';

const CAL_MS = 2200;

describe('Superman — regression: not-moving fires after a real rep + idle (Fix O)', () => {
  it('DOES fire not-moving when user rests at prone position after completing a rep', () => {
    const REP_END_MS = CAL_MS + 2500;
    const TOTAL_MS = REP_END_MS + 8000;

    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) {
          return {
            shoulderRise: 0,
            armsForward: true,
          } as SupermanPoseIntent;
        }
        if (tMs < REP_END_MS) {
          const tInRep = tMs - CAL_MS;
          let shoulderRise: number;
          if (tInRep < 1000) {
            shoulderRise = (tInRep / 1000) * 0.08; // 0 → 0.08
          } else if (tInRep < 1500) {
            shoulderRise = 0.08; // hold at top
          } else {
            shoulderRise = 0.08 - ((tInRep - 1500) / 1000) * 0.08; // 0.08 → 0
          }
          return {
            shoulderRise: Math.max(0, shoulderRise),
            armsForward: true,
          } as SupermanPoseIntent;
        }
        // Post-rep idle: prone rest.
        return {
          shoulderRise: 0,
          armsForward: true,
        } as SupermanPoseIntent;
      },
      buildSupermanPose,
      { fps: 30, durationMs: TOTAL_MS },
    );

    const result = runSupermanSession(frames);

    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThan(500);
    // Core assertion: idle warning must fire after the post-rep settle.
    expect(countWarnings(result, 'not-moving')).toBeGreaterThanOrEqual(1);
  });
});
