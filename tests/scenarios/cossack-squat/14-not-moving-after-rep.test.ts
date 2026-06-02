/**
 * Fix O — the idle `not-moving` warning must fire after a REAL rep, not just
 * from cold start (the post-rep EMA-decay reseed prevents the variance gate
 * from being permanently suppressed by the decay tail).
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildCossackSquatPose } from '../../harness/pose-stub';
import { runCossackSquatSession, countWarnings } from '../../harness/runner';
import type { CossackSquatPoseIntent } from '../../harness/types';

const CAL_MS = 2200;

describe('Cossack Squat — not-moving fires after a real rep + idle (Fix O)', () => {
  it('DOES fire not-moving when the user rests after completing a rep', () => {
    const REP_END_MS = CAL_MS + 2500;
    const TOTAL_MS = REP_END_MS + 8000;
    const frames = buildFrames(
      (tMs): CossackSquatPoseIntent => {
        if (tMs < CAL_MS) {
          return { workingKneeFlexionDeg: 0, workingSide: 'left', hipShift: 0, feetWidthRatio: 1.8, armsAtSides: true };
        }
        if (tMs < REP_END_MS) {
          const tInRep = tMs - CAL_MS;
          let flex: number;
          if (tInRep < 1000) flex = (tInRep / 1000) * 95;
          else if (tInRep < 1500) flex = 95;
          else flex = 95 - ((tInRep - 1500) / 1000) * 95;
          return { workingKneeFlexionDeg: flex, workingSide: 'left', hipShift: (flex / 95) * 0.05, feetWidthRatio: 1.8, armsAtSides: true };
        }
        return { workingKneeFlexionDeg: 0, workingSide: 'left', hipShift: 0, feetWidthRatio: 1.8, armsAtSides: true };
      },
      buildCossackSquatPose,
      { fps: 30, durationMs: TOTAL_MS },
    );

    const result = runCossackSquatSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.completedReps.length).toBe(1);
    expect(countWarnings(result, 'not-moving')).toBeGreaterThanOrEqual(1);
  });
});
