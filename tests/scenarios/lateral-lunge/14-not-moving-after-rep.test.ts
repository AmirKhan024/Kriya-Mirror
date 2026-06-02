/**
 * Fix O — the idle `not-moving` warning must fire after a REAL rep, not just
 * from cold start. Without the post-rep EMA-decay reseed, the smoothedFlexion
 * decay tail keeps `max - min` inflated so the variance gate never re-closes
 * and not-moving never fires once the user has done a rep and then rests.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildLateralLungePose } from '../../harness/pose-stub';
import { runLateralLungeSession, countWarnings } from '../../harness/runner';
import type { LateralLungePoseIntent } from '../../harness/types';

const CAL_MS = 2200;

describe('Lateral Lunge — not-moving fires after a real rep + idle (Fix O)', () => {
  it('DOES fire not-moving when the user rests after completing a rep', () => {
    const REP_END_MS = CAL_MS + 2500;
    const TOTAL_MS = REP_END_MS + 8000;
    const frames = buildFrames(
      (tMs): LateralLungePoseIntent => {
        if (tMs < CAL_MS) {
          return { workingKneeFlexionDeg: 0, workingSide: 'left', lateralShift: 0, armsAtSides: true };
        }
        if (tMs < REP_END_MS) {
          const tInRep = tMs - CAL_MS;
          let flex: number;
          if (tInRep < 1000) flex = (tInRep / 1000) * 90;
          else if (tInRep < 1500) flex = 90;
          else flex = 90 - ((tInRep - 1500) / 1000) * 90;
          return { workingKneeFlexionDeg: flex, workingSide: 'left', lateralShift: (flex / 90) * 0.14, armsAtSides: true };
        }
        return { workingKneeFlexionDeg: 0, workingSide: 'left', lateralShift: 0, armsAtSides: true };
      },
      buildLateralLungePose,
      { fps: 30, durationMs: TOTAL_MS },
    );

    const result = runLateralLungeSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.completedReps.length).toBe(1);
    expect(countWarnings(result, 'not-moving')).toBeGreaterThanOrEqual(1);
  });
});
