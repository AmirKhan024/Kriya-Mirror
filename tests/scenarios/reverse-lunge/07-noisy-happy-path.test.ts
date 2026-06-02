/**
 * Robustness: reverse-lunge reps must still count under MediaPipe-style jitter.
 * (Front camera + backward step has more rear-leg occlusion in reality, but the
 * engine tracks the visible deepest/front leg; this confirms jitter tolerance.)
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildLungePose } from '../../harness/pose-stub';
import { runReverseLungeSession } from '../../harness/runner';
import type { LungePoseIntent } from '../../harness/types';

const CAL_MS = 2200;
const REP_MS = 3000;

describe('Reverse Lunge — noisy happy path', () => {
  it('counts most of 6 alternating reps under positional noise', () => {
    const reps = 6;
    const frames = buildFrames(
      (tMs): LungePoseIntent => {
        if (tMs < CAL_MS) return { kneeFlexionDeg: 0, frontLeg: 'left', armsAtSides: true, noise: 0.004, seed: 5 };
        const repIdx = Math.floor((tMs - CAL_MS) / REP_MS);
        const frontLeg: 'left' | 'right' = repIdx % 2 === 0 ? 'left' : 'right';
        const tInRep = (tMs - CAL_MS) % REP_MS;
        let flex: number;
        if (tInRep < 1000) flex = (tInRep / 1000) * 90;
        else if (tInRep < 1500) flex = 90;
        else if (tInRep < 2500) flex = 90 - ((tInRep - 1500) / 1000) * 90;
        else flex = 0;
        return { kneeFlexionDeg: flex, frontLeg, armsAtSides: false, noise: 0.004, seed: 5 + repIdx };
      },
      buildLungePose,
      { fps: 30, durationMs: CAL_MS + reps * REP_MS },
    );
    const result = runReverseLungeSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.completedReps.length).toBeGreaterThanOrEqual(5);
    expect(result.completedReps.length).toBeLessThanOrEqual(6);
  });
});
