/**
 * Regression test for Dead Bug Fix O — EMA decay reseed.
 *
 * Bug: after a real rep the smoothed extension metric drifts from ~60° toward
 * 0° over several seconds. While decaying, max−min stays large, permanently
 * inflating the variance accumulator and blocking the 'not-moving' fire even
 * though the user is genuinely idle.
 *
 * Fix O: once the per-frame EMA delta has settled (Δ < threshold for 500 ms),
 * drop the cached min/max and reseed from the current value so the variance
 * window reflects only true post-settle jitter.
 *
 * Profile:
 *   0 – CAL_MS          : calibration (tabletop, armsUp)
 *   CAL_MS – REP_END_MS : one full rep (extension 0 → 60 → 0 over 2.5 s)
 *   REP_END_MS – END    : 8 s of tabletop idle → must fire 'not-moving'
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildDeadBugPose } from '../../harness/pose-stub';
import { runDeadBugSession, countWarnings } from '../../harness/runner';
import type { DeadBugPoseIntent } from '../../harness/types';

const CAL_MS = 2200;

describe('Dead Bug — regression: not-moving fires after a real rep + idle (Fix O)', () => {
  it('DOES fire not-moving when user rests at tabletop after completing a rep', () => {
    // Cal 2.2 s → one rep (extend 0→60 over 1 s, hold 60 for 0.5 s, return 60→0 over 1 s)
    // → 8 s idle. Total ≈ 12.7 s.
    const REP_END_MS = CAL_MS + 2500;
    const TOTAL_MS = REP_END_MS + 8000;

    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) {
          return {
            legExtensionDeg: 0,
            armsUp: true,
          } as DeadBugPoseIntent;
        }
        if (tMs < REP_END_MS) {
          const tInRep = tMs - CAL_MS;
          let legExtensionDeg: number;
          if (tInRep < 1000) {
            legExtensionDeg = (tInRep / 1000) * 60; // 0 → 60
          } else if (tInRep < 1500) {
            legExtensionDeg = 60; // hold at top
          } else {
            legExtensionDeg = 60 - ((tInRep - 1500) / 1000) * 60; // 60 → 0
          }
          return {
            legExtensionDeg,
            armsUp: true,
          } as DeadBugPoseIntent;
        }
        // Post-rep idle: tabletop rest.
        return {
          legExtensionDeg: 0,
          armsUp: true,
        } as DeadBugPoseIntent;
      },
      buildDeadBugPose,
      { fps: 30, durationMs: TOTAL_MS },
    );

    const result = runDeadBugSession(frames);

    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThan(500);
    // Core assertion: idle warning must fire after the post-rep settle.
    expect(countWarnings(result, 'not-moving')).toBeGreaterThanOrEqual(1);
  });
});
