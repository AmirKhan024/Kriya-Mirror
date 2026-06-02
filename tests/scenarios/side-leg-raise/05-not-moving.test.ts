/**
 * Fix I + Fix P — `not-moving` idle prompt. After calibration confirms, if the
 * user just stands there (both legs down, no reps) for ≥ 5s, fire `not-moving`.
 * Fix P: the cold-start cooldown must allow the FIRST fire.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildSideLegRaisePose } from '../../harness/pose-stub';
import { runSideLegRaiseSession, countWarnings } from '../../harness/runner';
import type { SideLegRaisePoseIntent } from '../../harness/types';

describe('Side Leg Raise — not-moving idle prompt (Fix I/P)', () => {
  it('fires not-moving after ~5s of standing still post-calibration', () => {
    const frames = buildFrames(
      () => ({ leftAbductionDeg: 0, rightAbductionDeg: 0 } as SideLegRaisePoseIntent),
      buildSideLegRaisePose,
      { fps: 30, durationMs: 8000 },
    );
    const result = runSideLegRaiseSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'not-moving')).toBeGreaterThanOrEqual(1);
  });

  it('does NOT fire not-moving while the user is actively doing reps', () => {
    const CAL_MS = 2200;
    const REP_MS = 2000;
    const frames = buildFrames(
      (tMs): SideLegRaisePoseIntent => {
        if (tMs < CAL_MS) return { leftAbductionDeg: 0, rightAbductionDeg: 0 };
        const inRep = (tMs - CAL_MS) % REP_MS;
        let abd = 0;
        if (inRep < 600) abd = (inRep / 600) * 35;
        else if (inRep < 900) abd = 35;
        else if (inRep < 1500) abd = 35 - ((inRep - 900) / 600) * 35;
        return { leftAbductionDeg: abd, rightAbductionDeg: 0 };
      },
      buildSideLegRaisePose,
      { fps: 30, durationMs: CAL_MS + 3 * REP_MS },
    );
    const result = runSideLegRaiseSession(frames);
    expect(countWarnings(result, 'not-moving')).toBe(0);
  });
});
