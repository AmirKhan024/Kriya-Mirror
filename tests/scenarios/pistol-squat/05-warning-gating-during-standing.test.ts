/**
 * Fix A regression: during STANDING (between reps), valgus and trunk-lean
 * must NOT fire. The user is resting between reps — mild knee cave or lean
 * during the REST phase should not spam warnings.
 *
 * Scenario: inject valgus frames only during the STANDING rest phase between reps.
 * Assert: zero valgus warnings during those frames.
 *
 * Note: valgus detection also has a rawFlex > 30° guard, so at 0° STANDING
 * the valgus check is skipped. Even if it wasn't, Fix A gates it to inActiveRep only.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildPistolSquatPose } from '../../harness/pose-stub';
import { runPistolSquatSession, countWarnings } from '../../harness/runner';
import type { PistolSquatPoseIntent } from '../../harness/types';

const CAL_MS = 2200;

describe('Pistol Squat — warning gating during STANDING (Fix A)', () => {
  it('valgus frames ONLY during STANDING rest phase → zero valgus warnings', () => {
    // One full rep (0→90→0 over 2900ms), then 3s STANDING with valgus.
    // During STANDING: standingLeg=null (immediate return false from valgus detection)
    // AND inActiveRep=false (Fix A gate). Double protection against false fires.
    const REP_DURATION_MS = 2900;
    const TOTAL_MS = CAL_MS + REP_DURATION_MS + 3000;

    const frames = buildFrames(
      (tMs): PistolSquatPoseIntent => {
        if (tMs < CAL_MS) {
          return { kneeFlexionDeg: 0, standingLeg: 'left', armsForward: false };
        }
        const tInRep = tMs - CAL_MS;
        const inStandingRest = tInRep >= REP_DURATION_MS;

        let flex: number;
        if (tInRep < 1200) flex = (tInRep / 1200) * 90;
        else if (tInRep < 1700) flex = 90;
        else if (tInRep < 2900) flex = 90 - ((tInRep - 1700) / 1200) * 90;
        else flex = 0;

        return {
          kneeFlexionDeg: flex,
          standingLeg: 'left',
          armsForward: !inStandingRest,
          // Valgus ONLY during the STANDING REST phase (flex=0)
          valgusRatio: inStandingRest ? 0.25 : 0,
        };
      },
      buildPistolSquatPose,
      { fps: 30, durationMs: TOTAL_MS },
    );

    const result = runPistolSquatSession(frames);

    // The rep itself should have counted
    expect(result.completedReps.length).toBe(1);
    // Zero valgus warnings because valgus only occurred during STANDING
    // (Fix A: gated to inActiveRep only; also rawFlex=0 < 30° guard blocks it)
    expect(countWarnings(result, 'valgus')).toBe(0);
  });

  it('trunk-lean frames ONLY during STANDING rest → zero trunk-lean warnings', () => {
    const REP_DURATION_MS = 2900;
    const TOTAL_MS = CAL_MS + REP_DURATION_MS + 3000;

    const frames = buildFrames(
      (tMs): PistolSquatPoseIntent => {
        if (tMs < CAL_MS) {
          return { kneeFlexionDeg: 0, standingLeg: 'left', armsForward: false };
        }
        const tInRep = tMs - CAL_MS;
        const inStandingRest = tInRep >= REP_DURATION_MS;

        let flex: number;
        if (tInRep < 1200) flex = (tInRep / 1200) * 90;
        else if (tInRep < 1700) flex = 90;
        else if (tInRep < 2900) flex = 90 - ((tInRep - 1700) / 1200) * 90;
        else flex = 0;

        return {
          kneeFlexionDeg: flex,
          standingLeg: 'left',
          armsForward: !inStandingRest,
          // Trunk lean ONLY during STANDING rest phase
          trunkLeanDeg: inStandingRest ? 60 : 0,
        };
      },
      buildPistolSquatPose,
      { fps: 30, durationMs: TOTAL_MS },
    );

    const result = runPistolSquatSession(frames);

    // Zero trunk-lean warnings because lean only occurred during STANDING
    expect(countWarnings(result, 'trunk-lean')).toBe(0);
  });
});
