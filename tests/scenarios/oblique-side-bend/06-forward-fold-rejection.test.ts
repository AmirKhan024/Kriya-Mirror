/**
 * Forward-fold / non-lateral rejection — ported from the proven
 * standing_lateral_flexion reference. A side bend contaminated by a FORWARD FOLD
 * (shoulders drop toward the hips) must NOT count: the metric inflates as the
 * vertical span shrinks, so without these gates a forward bend would be
 * miscounted as a side bend.
 *
 * Three cases:
 *   1. Forward-fold-dominated bend  → rejected (forward-fold gate) → incomplete-bend
 *   2. Physiologically-implausible lean (>48°) → rejected (peak cap) → incomplete-bend
 *   3. CONTROL: a clean lateral bend of the SAME lateral magnitude DOES count
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildObliqueSideBendPose } from '../../harness/pose-stub';
import { runObliqueSideBendSession, countWarnings } from '../../harness/runner';
import type { ObliqueSideBendPoseIntent } from '../../harness/types';

const CAL_MS = 2200;

describe('Oblique Side Bend — forward-fold / non-lateral rejection', () => {
  it('rejects a bend dominated by a forward fold (does not count)', () => {
    const frames = buildFrames(
      (tMs): ObliqueSideBendPoseIntent => {
        if (tMs < CAL_MS) return { leanDeg: 0, forwardFold: 0 };
        const t = tMs - CAL_MS;
        // Modest lateral lean (15°) but a large forward shoulder drop → the
        // apparent angle inflates to ~26° while the shoulder-drop/lateral-shift
        // ratio is far above the rigid-rod expectation.
        if (t < 400) return { leanDeg: (t / 400) * 15, forwardFold: (t / 400) * 0.08 };
        if (t < 1400) return { leanDeg: 15, forwardFold: 0.08 };
        if (t < 1800) return { leanDeg: 15 - ((t - 1400) / 400) * 15, forwardFold: 0.08 - ((t - 1400) / 400) * 0.08 };
        return { leanDeg: 0, forwardFold: 0 };
      },
      buildObliqueSideBendPose,
      { fps: 30, durationMs: CAL_MS + 2000 },
    );
    const result = runObliqueSideBendSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.completedReps.length).toBe(0);
    expect(countWarnings(result, 'incomplete-bend')).toBeGreaterThan(0);
  });

  it('rejects a physiologically-implausible lean (>48°) as non-lateral', () => {
    const frames = buildFrames(
      (tMs): ObliqueSideBendPoseIntent => {
        if (tMs < CAL_MS) return { leanDeg: 0 };
        const t = tMs - CAL_MS;
        // Pure lateral but an impossible 55° — almost certainly a tracking
        // glitch / non-lateral motion. Forward-fold gate stays quiet (rigid-rod
        // ratio), so this exercises the peak cap specifically.
        if (t < 500) return { leanDeg: (t / 500) * 55 };
        if (t < 1000) return { leanDeg: 55 };
        if (t < 1700) return { leanDeg: 55 - ((t - 1000) / 700) * 55 };
        return { leanDeg: 0 }; // long rest so the rate-limited smoothed lean returns below LOW
      },
      buildObliqueSideBendPose,
      { fps: 30, durationMs: CAL_MS + 3200 },
    );
    const result = runObliqueSideBendSession(frames);
    expect(result.completedReps.length).toBe(0);
    expect(countWarnings(result, 'incomplete-bend')).toBeGreaterThan(0);
  });

  it('CONTROL: a clean lateral bend of the same lateral magnitude counts', () => {
    const frames = buildFrames(
      (tMs): ObliqueSideBendPoseIntent => {
        if (tMs < CAL_MS) return { leanDeg: 0 };
        const t = tMs - CAL_MS;
        // Same right-side bend but NO forward fold — a proper lateral bend.
        if (t < 500) return { leanDeg: (t / 500) * 28 };
        if (t < 900) return { leanDeg: 28 };
        if (t < 1500) return { leanDeg: 28 - ((t - 900) / 600) * 28 };
        return { leanDeg: 0 };
      },
      buildObliqueSideBendPose,
      { fps: 30, durationMs: CAL_MS + 1800 },
    );
    const result = runObliqueSideBendSession(frames);
    expect(result.completedReps.length).toBe(1);
    expect(result.completedReps[0].side).toBe('right');
    expect(countWarnings(result, 'incomplete-bend')).toBe(0);
  });
});
