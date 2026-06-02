/**
 * Rep validation:
 *   - A shallow lunge (front-leg peak below MIN_REP_DEPTH=50°) is rejected and
 *     fires `incomplete-lunge`.
 *   - A clean full lunge counts with a sensible depthDeg.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildLungePose } from '../../harness/pose-stub';
import { runReverseLungeSession, countWarnings } from '../../harness/runner';
import type { LungePoseIntent } from '../../harness/types';

const CAL_MS = 2200;
const REP_MS = 3000;

describe('Reverse Lunge — rep validation', () => {
  it('rejects a shallow lunge (peak < 50°) and fires incomplete-lunge', () => {
    const frames = buildFrames(
      (tMs): LungePoseIntent => {
        if (tMs < CAL_MS) return { kneeFlexionDeg: 0, frontLeg: 'left', armsAtSides: true };
        const tInRep = (tMs - CAL_MS) % REP_MS;
        // Peak only ~35° — clears DESCEND_START (25°) but below the 50° floor.
        let flex: number;
        if (tInRep < 1000) flex = (tInRep / 1000) * 35;
        else if (tInRep < 1500) flex = 35;
        else if (tInRep < 2500) flex = 35 - ((tInRep - 1500) / 1000) * 35;
        else flex = 0;
        return { kneeFlexionDeg: flex, frontLeg: 'left', armsAtSides: false };
      },
      buildLungePose,
      { fps: 30, durationMs: CAL_MS + REP_MS },
    );
    const result = runReverseLungeSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.completedReps.length).toBe(0);
    expect(countWarnings(result, 'incomplete-lunge')).toBeGreaterThan(0);
  });

  it('counts a clean full lunge with depthDeg in a sensible range', () => {
    const frames = buildFrames(
      (tMs): LungePoseIntent => {
        if (tMs < CAL_MS) return { kneeFlexionDeg: 0, frontLeg: 'right', armsAtSides: true };
        const tInRep = (tMs - CAL_MS) % REP_MS;
        let flex: number;
        if (tInRep < 1000) flex = (tInRep / 1000) * 95;
        else if (tInRep < 1500) flex = 95;
        else if (tInRep < 2500) flex = 95 - ((tInRep - 1500) / 1000) * 95;
        else flex = 0;
        return { kneeFlexionDeg: flex, frontLeg: 'right', armsAtSides: false };
      },
      buildLungePose,
      { fps: 30, durationMs: CAL_MS + REP_MS },
    );
    const result = runReverseLungeSession(frames);
    expect(result.completedReps.length).toBe(1);
    const rep = result.completedReps[0];
    expect(rep.frontLeg).toBe('right');
    expect(rep.depthDeg).toBeGreaterThanOrEqual(60);
    expect(countWarnings(result, 'incomplete-lunge')).toBe(0);
  });
});
