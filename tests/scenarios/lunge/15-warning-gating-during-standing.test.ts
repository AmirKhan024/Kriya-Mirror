/**
 * Regression test for round-5 Fix A on Lunge: posture warnings (valgus,
 * trunk-forward) must NOT fire while the user is resting in STANDING between
 * reps. Same bug pattern as squat had — `valgus` and `trunk-forward` would
 * fire every frame after calibration regardless of rep state, including
 * between reps where the user is just resting.
 *
 * Fix (engine.ts): gate `maybeEmitWarning('valgus' | 'trunk-forward')` to
 * `repState !== 'STANDING'`.
 *
 * This test holds the user in STANDING with a sustained trunk-lean and
 * asserts ZERO trunk-forward warnings for 5 seconds. Then it runs a real rep
 * with the same bad signal during DESCENDING and asserts the warning DOES
 * fire.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildLungePose } from '../../harness/pose-stub';
import { runLungeSession, countWarnings } from '../../harness/runner';
import type { LungePoseIntent } from '../../harness/types';

const CAL_MS = 2200;

describe('Lunge — posture warning gating (only fire when not STANDING)', () => {
  it('does NOT fire trunk-forward while user holds STANDING with bad form', () => {
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) {
          return {
            kneeFlexionDeg: 0,
            frontLeg: 'left' as const,
            armsAtSides: true,
          } as LungePoseIntent;
        }
        // Post-cal: still in STANDING (no flex) but with a sustained trunk lean.
        return {
          kneeFlexionDeg: 0,
          frontLeg: 'left' as const,
          armsAtSides: false,
          trunkLeanDeg: 65,    // past TRUNK_WARN_DEG=55
        } as LungePoseIntent;
      },
      buildLungePose,
      { fps: 30, durationMs: CAL_MS + 5000 },
    );

    const result = runLungeSession(frames);

    expect(countWarnings(result, 'trunk-forward')).toBe(0);
    expect(countWarnings(result, 'valgus')).toBe(0);
  });

  it('DOES fire trunk-forward once the user enters DESCENDING with bad form', () => {
    const repCycleMs = 3000;
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) {
          return {
            kneeFlexionDeg: 0,
            frontLeg: 'left' as const,
            armsAtSides: true,
          } as LungePoseIntent;
        }
        const tInRep = (tMs - CAL_MS) % repCycleMs;
        let kneeFlexionDeg: number;
        if (tInRep < 1000) kneeFlexionDeg = (tInRep / 1000) * 90;
        else if (tInRep < 1500) kneeFlexionDeg = 90;
        else if (tInRep < 2500) kneeFlexionDeg = 90 - ((tInRep - 1500) / 1000) * 90;
        else kneeFlexionDeg = 0;
        const inActive = kneeFlexionDeg > 25;
        return {
          kneeFlexionDeg,
          frontLeg: 'left' as const,
          armsAtSides: false,
          trunkLeanDeg: inActive ? 65 : 0,
        } as LungePoseIntent;
      },
      buildLungePose,
      { fps: 30, durationMs: CAL_MS + 2 * repCycleMs },
    );

    const result = runLungeSession(frames);
    expect(countWarnings(result, 'trunk-forward')).toBeGreaterThan(0);
  });
});
