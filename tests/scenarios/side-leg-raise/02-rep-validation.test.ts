/**
 * Rep validation:
 *   - A shallow raise (peak abduction below MIN_REP_ABDUCTION_DEG=22) is rejected
 *     and fires `low-leg-raise` — it does NOT count.
 *   - A clean full raise counts with a sensible depthDeg and the correct side.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildSideLegRaisePose } from '../../harness/pose-stub';
import { runSideLegRaiseSession, countWarnings } from '../../harness/runner';
import type { SideLegRaisePoseIntent } from '../../harness/types';

const CAL_MS = 2200;

describe('Side Leg Raise — rep validation', () => {
  it('rejects a shallow raise (peak < 22°) and fires low-leg-raise', () => {
    // Rise to only ~19° (clears HIGH=15 so the rep starts, but below the
    // 22° valid-rep floor), hold, then lower. One attempt.
    const frames = buildFrames(
      (tMs): SideLegRaisePoseIntent => {
        if (tMs < CAL_MS) return { leftAbductionDeg: 0, rightAbductionDeg: 0 };
        const t = tMs - CAL_MS;
        let abd = 0;
        if (t < 600) abd = (t / 600) * 19;
        else if (t < 1400) abd = 19;
        else if (t < 2000) abd = 19 - ((t - 1400) / 600) * 19;
        else abd = 0;
        return { leftAbductionDeg: abd, rightAbductionDeg: 0 };
      },
      buildSideLegRaisePose,
      { fps: 30, durationMs: CAL_MS + 2400 },
    );
    const result = runSideLegRaiseSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.completedReps.length).toBe(0);
    expect(countWarnings(result, 'low-leg-raise')).toBeGreaterThan(0);
  });

  it('counts a clean full raise with depthDeg ≈ peak abduction', () => {
    const frames = buildFrames(
      (tMs): SideLegRaisePoseIntent => {
        if (tMs < CAL_MS) return { leftAbductionDeg: 0, rightAbductionDeg: 0 };
        const t = tMs - CAL_MS;
        let abd = 0;
        if (t < 600) abd = (t / 600) * 38;
        else if (t < 900) abd = 38;
        else if (t < 1500) abd = 38 - ((t - 900) / 600) * 38;
        else abd = 0;
        return { leftAbductionDeg: 0, rightAbductionDeg: abd };
      },
      buildSideLegRaisePose,
      { fps: 30, durationMs: CAL_MS + 2000 },
    );
    const result = runSideLegRaiseSession(frames);
    expect(result.completedReps.length).toBe(1);
    const rep = result.completedReps[0];
    expect(rep.side).toBe('right');
    expect(rep.depthDeg).toBeGreaterThanOrEqual(30);
    expect(rep.depthDeg).toBeLessThanOrEqual(45);
    expect(countWarnings(result, 'low-leg-raise')).toBe(0);
  });
});
