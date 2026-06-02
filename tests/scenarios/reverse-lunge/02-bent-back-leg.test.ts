/**
 * The defining difference from the forward-lunge engine: a reverse lunge bends
 * the REAR knee (it drops toward the floor), so there is NO front-vs-back
 * "bilateral-squat" gap gate. A rep with a deeply-bent back leg must still
 * count (the forward-lunge engine would reject it as 'malformed-rep').
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildLungePose } from '../../harness/pose-stub';
import { runReverseLungeSession, countWarnings } from '../../harness/runner';
import type { LungePoseIntent } from '../../harness/types';

const CAL_MS = 2200;
const REP_MS = 3000;

describe('Reverse Lunge — bent back leg still counts (no gap gate)', () => {
  it('counts a rep where the rear knee is deeply bent (80°)', () => {
    const frames = buildFrames(
      (tMs): LungePoseIntent => {
        if (tMs < CAL_MS) return { kneeFlexionDeg: 0, backLegFlexionDeg: 0, frontLeg: 'left', armsAtSides: true };
        const tInRep = (tMs - CAL_MS) % REP_MS;
        let frontFlex: number;
        if (tInRep < 1000) frontFlex = (tInRep / 1000) * 90;
        else if (tInRep < 1500) frontFlex = 90;
        else if (tInRep < 2500) frontFlex = 90 - ((tInRep - 1500) / 1000) * 90;
        else frontFlex = 0;
        // Rear knee bends in proportion to the front (deep at the bottom) — a
        // forward lunge would reject this (gap < 20°); reverse lunge counts it.
        const backFlex = frontFlex * 0.85;
        return { kneeFlexionDeg: frontFlex, backLegFlexionDeg: backFlex, frontLeg: 'left', armsAtSides: false };
      },
      buildLungePose,
      { fps: 30, durationMs: CAL_MS + REP_MS },
    );
    const result = runReverseLungeSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.completedReps.length).toBe(1);
    expect(countWarnings(result, 'malformed-rep')).toBe(0);
  });
});
