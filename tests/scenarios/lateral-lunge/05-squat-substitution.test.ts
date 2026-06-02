/**
 * The lateral-lunge-specific gate adapted from the Cossack-squat tracker: the
 * planted leg must stay straight. If the user bends BOTH knees (a squat, not a
 * lunge), the working-vs-planted flex GAP collapses → the rep is rejected as a
 * `malformed-rep`, and the per-frame `leg-not-straight` coaching cue fires.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildLateralLungePose } from '../../harness/pose-stub';
import { runLateralLungeSession, countWarnings } from '../../harness/runner';
import type { LateralLungePoseIntent } from '../../harness/types';

const CAL_MS = 2200;
const repCycleMs = 3000;

describe('Lateral Lunge — squat substitution (both knees bend)', () => {
  it('rejects the rep and fires leg-not-straight when both legs bend equally', () => {
    const frames = buildFrames(
      (tMs): LateralLungePoseIntent => {
        if (tMs < CAL_MS) return { workingKneeFlexionDeg: 0, straightLegFlexionDeg: 5, workingSide: 'left', lateralShift: 0, armsAtSides: true };
        const tInRep = (tMs - CAL_MS) % repCycleMs;
        let flex: number;
        if (tInRep < 1000) flex = (tInRep / 1000) * 90;
        else if (tInRep < 1500) flex = 90;
        else if (tInRep < 2500) flex = 90 - ((tInRep - 1500) / 1000) * 90;
        else flex = 0;
        // Both knees bend together (a squat) and the hips sink straight down
        // (no lateral shift).
        return {
          workingKneeFlexionDeg: flex,
          straightLegFlexionDeg: flex,
          workingSide: 'left',
          lateralShift: 0,
          armsAtSides: true,
        };
      },
      buildLateralLungePose,
      { fps: 30, durationMs: CAL_MS + 3 * repCycleMs + 500 },
    );
    const result = runLateralLungeSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.completedReps.length).toBe(0);
    expect(countWarnings(result, 'malformed-rep')).toBeGreaterThan(0);
    expect(countWarnings(result, 'leg-not-straight')).toBeGreaterThan(0);
  });
});
