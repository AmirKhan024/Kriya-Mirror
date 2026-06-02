/**
 * Rep validation:
 *   - A shallow bend (peak lean below MIN_REP_LEAN_DEG=18) is rejected and fires
 *     `incomplete-bend` — it does NOT count.
 *   - A clean full bend counts with a sensible depthDeg and the correct side.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildObliqueSideBendPose } from '../../harness/pose-stub';
import { runObliqueSideBendSession, countWarnings } from '../../harness/runner';
import type { ObliqueSideBendPoseIntent } from '../../harness/types';

const CAL_MS = 2200;

describe('Oblique Side Bend — rep validation', () => {
  it('rejects a shallow bend (peak < 18°) and fires incomplete-bend', () => {
    // Rise to only ~15° (clears HIGH=12 so the rep starts, but below the 18°
    // valid floor), hold, then return upright.
    const frames = buildFrames(
      (tMs): ObliqueSideBendPoseIntent => {
        if (tMs < CAL_MS) return { leanDeg: 0 };
        const t = tMs - CAL_MS;
        let mag = 0;
        if (t < 600) mag = (t / 600) * 15;
        else if (t < 1400) mag = 15;
        else if (t < 2000) mag = 15 - ((t - 1400) / 600) * 15;
        return { leanDeg: mag };
      },
      buildObliqueSideBendPose,
      { fps: 30, durationMs: CAL_MS + 2400 },
    );
    const result = runObliqueSideBendSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.completedReps.length).toBe(0);
    expect(countWarnings(result, 'incomplete-bend')).toBeGreaterThan(0);
  });

  it('counts a clean full bend with depthDeg ≈ peak lean', () => {
    const frames = buildFrames(
      (tMs): ObliqueSideBendPoseIntent => {
        if (tMs < CAL_MS) return { leanDeg: 0 };
        const t = tMs - CAL_MS;
        let mag = 0;
        if (t < 600) mag = (t / 600) * 30;
        else if (t < 900) mag = 30;
        else if (t < 1500) mag = 30 - ((t - 900) / 600) * 30;
        return { leanDeg: -mag }; // bend left
      },
      buildObliqueSideBendPose,
      { fps: 30, durationMs: CAL_MS + 2000 },
    );
    const result = runObliqueSideBendSession(frames);
    expect(result.completedReps.length).toBe(1);
    const rep = result.completedReps[0];
    expect(rep.side).toBe('left');
    expect(rep.depthDeg).toBeGreaterThanOrEqual(24);
    expect(rep.depthDeg).toBeLessThanOrEqual(40);
    expect(countWarnings(result, 'incomplete-bend')).toBe(0);
  });
});
