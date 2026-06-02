/**
 * Robustness: alternating leg-raise reps must still count under MediaPipe-style
 * positional jitter on the (noisy) ankle landmark. EMA + per-frame clamp absorb it.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildSideLegRaisePose } from '../../harness/pose-stub';
import { runSideLegRaiseSession, countWarnings } from '../../harness/runner';
import type { SideLegRaisePoseIntent } from '../../harness/types';

const CAL_MS = 2200;
const REP_MS = 2000;

function abductionAt(inRep: number): number {
  if (inRep < 600) return (inRep / 600) * 35;
  if (inRep < 900) return 35;
  if (inRep < 1500) return 35 - ((inRep - 900) / 600) * 35;
  return 0;
}

describe('Side Leg Raise — noisy happy path', () => {
  it('counts most of 6 alternating reps under positional noise', () => {
    const reps = 6;
    const frames = buildFrames(
      (tMs): SideLegRaisePoseIntent => {
        if (tMs < CAL_MS) return { leftAbductionDeg: 0, rightAbductionDeg: 0, noise: 0.004, seed: 11 };
        const t = tMs - CAL_MS;
        const repIdx = Math.floor(t / REP_MS);
        const abd = abductionAt(t % REP_MS);
        return repIdx % 2 === 0
          ? { leftAbductionDeg: abd, rightAbductionDeg: 0, noise: 0.004, seed: 11 + repIdx }
          : { leftAbductionDeg: 0, rightAbductionDeg: abd, noise: 0.004, seed: 11 + repIdx };
      },
      buildSideLegRaisePose,
      { fps: 30, durationMs: CAL_MS + reps * REP_MS + 200 },
    );
    const result = runSideLegRaiseSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.completedReps.length).toBeGreaterThanOrEqual(5);
    expect(result.completedReps.length).toBeLessThanOrEqual(6);
  });

  // Regression for the physical-test bug: normal-speed reps must NOT be rejected
  // as 'ballistic' under landmark jitter. The velocity check now samples the
  // (stable) knee, not the noisy ankle, so even elevated noise leaves the reps
  // counting and the form score healthy.
  it('does not reject normal-speed reps as ballistic under elevated noise', () => {
    const reps = 5;
    const frames = buildFrames(
      (tMs): SideLegRaisePoseIntent => {
        if (tMs < CAL_MS) return { leftAbductionDeg: 0, rightAbductionDeg: 0, noise: 0.006, seed: 21 };
        const inRep = (tMs - CAL_MS) % REP_MS;
        return { leftAbductionDeg: abductionAt(inRep), rightAbductionDeg: 0, noise: 0.006, seed: 21 };
      },
      buildSideLegRaisePose,
      { fps: 30, durationMs: CAL_MS + reps * REP_MS + 200 },
    );
    const result = runSideLegRaiseSession(frames);
    expect(result.completedReps.length).toBeGreaterThanOrEqual(4);
    expect(countWarnings(result, 'malformed-rep')).toBe(0);
    // Form score is no longer tanked by torso-swing.
    const avgForm = result.completedReps.reduce((s, r) => s + r.form, 0) / result.completedReps.length;
    expect(avgForm).toBeGreaterThanOrEqual(90);
  });
});
