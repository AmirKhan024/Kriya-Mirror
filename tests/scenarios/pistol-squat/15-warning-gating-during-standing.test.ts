/**
 * Warning gating during STANDING — correlated with rep state transitions.
 *
 * Tests that posture warnings DO fire during DESCENDING/AT_BOTTOM/ASCENDING
 * but DON'T fire during STANDING. Inject valgus at specific timestamps and
 * correlate with rep state.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildPistolSquatPose } from '../../harness/pose-stub';
import { runPistolSquatSession, countWarnings } from '../../harness/runner';
import type { PistolSquatPoseIntent } from '../../harness/types';

const CAL_MS = 2200;

describe('Pistol Squat — warning gating: fires in active rep, not in STANDING', () => {
  it('trunk-lean during DESCENDING DOES fire a warning (active rep gating confirmation)', () => {
    // Rep: 0→90 over 1200ms with trunk lean > 55° throughout middle of descent.
    // This confirms that Fix A allows posture warnings to fire during active reps.
    const TOTAL_MS = CAL_MS + 3500;
    const frames = buildFrames(
      (tMs): PistolSquatPoseIntent => {
        if (tMs < CAL_MS) {
          return { kneeFlexionDeg: 0, standingLeg: 'left', armsForward: false };
        }
        const tInRep = tMs - CAL_MS;
        let flex: number;
        if (tInRep < 1200) flex = (tInRep / 1200) * 90;
        else if (tInRep < 1700) flex = 90;
        else if (tInRep < 2900) flex = 90 - ((tInRep - 1700) / 1200) * 90;
        else flex = 0;
        // Trunk lean > 55° throughout middle of descent
        const inDescent = tInRep >= 200 && tInRep <= 1200;
        return {
          kneeFlexionDeg: flex,
          standingLeg: 'left',
          armsForward: tInRep < 2900,
          trunkLeanDeg: inDescent ? 60 : 0,
        };
      },
      buildPistolSquatPose,
      { fps: 30, durationMs: TOTAL_MS },
    );

    const result = runPistolSquatSession(frames);
    expect(countWarnings(result, 'trunk-lean')).toBeGreaterThan(0);
  });

  it('valgus ONLY during pre-rep STANDING → zero warnings', () => {
    // No rep, just standing with valgus — warnings should be gated
    const TOTAL_MS = CAL_MS + 4000;
    const frames = buildFrames(
      (tMs): PistolSquatPoseIntent => {
        if (tMs < CAL_MS) {
          return { kneeFlexionDeg: 0, standingLeg: 'left', armsForward: false };
        }
        // Post-cal: still in STANDING (no rep started), with continuous valgus
        return {
          kneeFlexionDeg: 0,
          standingLeg: 'left',
          armsForward: false,
          valgusRatio: 0.25,  // valgus while standing
        };
      },
      buildPistolSquatPose,
      { fps: 30, durationMs: TOTAL_MS },
    );

    const result = runPistolSquatSession(frames);
    expect(countWarnings(result, 'valgus')).toBe(0);
  });

  it('trunk-lean ONLY during pre-rep STANDING → zero trunk-lean warnings', () => {
    const TOTAL_MS = CAL_MS + 4000;
    const frames = buildFrames(
      (tMs): PistolSquatPoseIntent => {
        if (tMs < CAL_MS) {
          return { kneeFlexionDeg: 0, standingLeg: 'left', armsForward: false };
        }
        // Post-cal STANDING with trunk lean
        return {
          kneeFlexionDeg: 0,
          standingLeg: 'left',
          armsForward: false,
          trunkLeanDeg: 60,
        };
      },
      buildPistolSquatPose,
      { fps: 30, durationMs: TOTAL_MS },
    );

    const result = runPistolSquatSession(frames);
    // Trunk lean of 60° during STANDING should NOT trigger trunk-lean
    expect(countWarnings(result, 'trunk-lean')).toBe(0);
  });
});
