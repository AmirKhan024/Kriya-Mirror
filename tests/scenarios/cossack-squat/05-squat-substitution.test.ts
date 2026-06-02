/**
 * The cossack gate: the EXTENDED leg must stay straight. If the user bends BOTH
 * knees (a bilateral squat, not a cossack), the working-vs-extended flex GAP
 * collapses → the rep is rejected as `malformed-rep`, and the per-frame
 * `leg-not-straight` coaching cue fires.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildCossackSquatPose } from '../../harness/pose-stub';
import { runCossackSquatSession, countWarnings } from '../../harness/runner';
import type { CossackSquatPoseIntent } from '../../harness/types';

const CAL_MS = 2200;
const repCycleMs = 3000;

describe('Cossack Squat — squat substitution (both knees bend)', () => {
  it('rejects the rep and fires leg-not-straight when both legs bend equally', () => {
    const frames = buildFrames(
      (tMs): CossackSquatPoseIntent => {
        if (tMs < CAL_MS) return { workingKneeFlexionDeg: 0, straightLegFlexionDeg: 5, workingSide: 'left', hipShift: 0, feetWidthRatio: 1.8, armsAtSides: true };
        const tInRep = (tMs - CAL_MS) % repCycleMs;
        let flex: number;
        if (tInRep < 1000) flex = (tInRep / 1000) * 95;
        else if (tInRep < 1500) flex = 95;
        else if (tInRep < 2500) flex = 95 - ((tInRep - 1500) / 1000) * 95;
        else flex = 0;
        // Both knees bend together (a bilateral squat), hips sink straight down.
        return {
          workingKneeFlexionDeg: flex,
          straightLegFlexionDeg: flex,
          workingSide: 'left',
          hipShift: (flex / 95) * 0.05,
          feetWidthRatio: 1.8,
          armsAtSides: true,
        };
      },
      buildCossackSquatPose,
      { fps: 30, durationMs: CAL_MS + 3 * repCycleMs + 500 },
    );
    const result = runCossackSquatSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.completedReps.length).toBe(0);
    expect(countWarnings(result, 'malformed-rep')).toBeGreaterThan(0);
    expect(countWarnings(result, 'leg-not-straight')).toBeGreaterThan(0);
  });
});
