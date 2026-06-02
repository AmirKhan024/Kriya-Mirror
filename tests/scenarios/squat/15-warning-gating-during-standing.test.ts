/**
 * Regression test for the "warning spam between reps" bug surfaced by Amir's
 * 2026-05-25 physical test (round 2). Console logs showed 11x heel-lift,
 * 1x valgus, and 1x feet-narrow firing across ~27s of pure STANDING state —
 * the user was upright between reps, not squatting, and was being coached
 * to "keep heels down" anyway.
 *
 * Fix (engine.ts): posture warnings (heel-lift, valgus, trunk-forward,
 * feet-narrow) are gated to `repState !== 'STANDING'`. Distance / facing /
 * not-moving warnings continue to fire regardless of state.
 *
 * This test holds the user in STANDING with deliberately bad signals
 * (heel lifted, valgus, trunk forward, feet narrow) and asserts ZERO posture
 * warnings emit. Then it runs a clean rep with the same bad signals during
 * the active phase and asserts the warnings DO emit then.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildSquatPose } from '../../harness/pose-stub';
import { runSquatSession, countWarnings } from '../../harness/runner';
import type { SquatPoseIntent } from '../../harness/types';

const CAL_MS = 2200;

describe('Squat — posture warning gating (only fire when not STANDING)', () => {
  it('does NOT fire heel-lift / valgus / trunk-forward / feet-narrow while user stands idle', () => {
    // After calibration, hold STANDING (kneeFlexionDeg = 0) for 8 seconds
    // while injecting all four bad signals continuously. Pre-fix this would
    // have spammed warnings; post-fix the engine gates them.
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) {
          return {
            kneeFlexionDeg: 0,
            feetWidthRatio: 1.25,
            armsOverhead: true,
          } as SquatPoseIntent;
        }
        // Standing idle with bad form-ish signals (engine should suppress).
        return {
          kneeFlexionDeg: 0,
          feetWidthRatio: 0.6,    // narrow stance
          armsOverhead: false,
          heelLift: 0.05,         // past HEEL_LIFT_THRESHOLD=0.032
          valgusRatio: 0.7,       // knees collapsed
          trunkLeanDeg: 65,       // past trunk-forward threshold
        } as SquatPoseIntent;
      },
      buildSquatPose,
      { fps: 30, durationMs: CAL_MS + 8000 },
    );

    const result = runSquatSession(frames);

    expect(countWarnings(result, 'heel-lift')).toBe(0);
    expect(countWarnings(result, 'valgus')).toBe(0);
    expect(countWarnings(result, 'trunk-forward')).toBe(0);
    expect(countWarnings(result, 'feet-narrow')).toBe(0);
  });

  it('DOES fire posture warnings once the user enters DESCENDING / BOTTOM', () => {
    // Same bad signals — but now they appear during the active phase of a
    // rep. Engine should emit warnings as before.
    const repCycleMs = 3000;
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) {
          return {
            kneeFlexionDeg: 0,
            feetWidthRatio: 1.25,
            armsOverhead: true,
          } as SquatPoseIntent;
        }
        const tInRep = (tMs - CAL_MS) % repCycleMs;
        let kneeFlexionDeg: number;
        if (tInRep < 1000) kneeFlexionDeg = (tInRep / 1000) * 100;
        else if (tInRep < 1500) kneeFlexionDeg = 100;
        else if (tInRep < 2500) kneeFlexionDeg = 100 - ((tInRep - 1500) / 1000) * 100;
        else kneeFlexionDeg = 0;
        const inActive = kneeFlexionDeg > 25;
        return {
          kneeFlexionDeg,
          feetWidthRatio: 1.25,
          armsOverhead: false,
          heelLift: inActive ? 0.05 : 0,
          trunkLeanDeg: inActive ? 65 : 0,
        } as SquatPoseIntent;
      },
      buildSquatPose,
      { fps: 30, durationMs: CAL_MS + 2 * repCycleMs },
    );

    const result = runSquatSession(frames);

    expect(countWarnings(result, 'heel-lift')).toBeGreaterThan(0);
    expect(countWarnings(result, 'trunk-forward')).toBeGreaterThan(0);
  });
});
