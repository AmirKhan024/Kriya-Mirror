/**
 * Regression test for round-5 Fix A on Push-Up: posture warnings (hip-sag,
 * hip-pike, spine-misaligned) must NOT fire while the user is resting in TOP
 * between reps. Same problem squat had with heel-lift / valgus / trunk-forward
 * firing 11x during a 27s pause between reps.
 *
 * Fix (engine.ts): gate `maybeEmitWarning('hip-sag' | 'hip-pike' |
 * 'spine-misaligned')` to `repState !== 'TOP'`. Tracking-validity signals
 * (not-moving) and rep-rejection signals (incomplete-pushup / malformed-rep)
 * stay ungated.
 *
 * This test holds the user in TOP with deliberately sagging hips for 5
 * seconds and asserts ZERO hip-sag warnings. Then it runs a real rep with
 * the same bad signal during LOWERING and asserts the warnings DO fire.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildPushupPose } from '../../harness/pose-stub';
import { runPushupSession, countWarnings } from '../../harness/runner';
import type { PushupPoseIntent } from '../../harness/types';

const CAL_MS = 2200;

describe('Push-Up — posture warning gating (only fire when not TOP)', () => {
  it('does NOT fire hip-sag / hip-pike / spine-misaligned while user holds TOP idle', () => {
    // After calibration, stay in TOP (elbowFlexionDeg = 0) for 5 seconds with
    // a sustained hipDelta past the sag threshold. Pre-fix this would have
    // spammed hip-sag every ~2.5s. Post-fix: zero emissions because the user
    // isn't in an active rep.
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) {
          // Clean calibration pose (no hip injection during cal — cal would
          // capture a degraded baseline. We want post-cal sag, not pre-cal sag.)
          return {
            elbowFlexionDeg: 0,
            side: 'left' as const,
          } as PushupPoseIntent;
        }
        // Post-cal: still in TOP, but with bad hip alignment.
        return {
          elbowFlexionDeg: 0,
          side: 'left' as const,
          hipDelta: 0.06,       // past HIP_SAG_THRESHOLD=0.04
        } as PushupPoseIntent;
      },
      buildPushupPose,
      { fps: 30, durationMs: CAL_MS + 5000 },
    );

    const result = runPushupSession(frames);

    expect(countWarnings(result, 'hip-sag')).toBe(0);
    expect(countWarnings(result, 'hip-pike')).toBe(0);
    expect(countWarnings(result, 'spine-misaligned')).toBe(0);
  });

  it('DOES fire hip-sag once the user enters LOWERING / AT_BOTTOM with bad form', () => {
    // Same bad signals — but now they only appear during the active phase of
    // a rep. Engine should emit warnings as before.
    const repCycleMs = 3000;
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) {
          return {
            elbowFlexionDeg: 0,
            side: 'left' as const,
          } as PushupPoseIntent;
        }
        const tInRep = (tMs - CAL_MS) % repCycleMs;
        let elbowFlex: number;
        if (tInRep < 1000) elbowFlex = (tInRep / 1000) * 90;
        else if (tInRep < 1500) elbowFlex = 90;
        else if (tInRep < 2500) elbowFlex = 90 - ((tInRep - 1500) / 1000) * 90;
        else elbowFlex = 0;
        // Hips sag ONLY while flexing past the descent threshold.
        const inActive = elbowFlex > 25;
        return {
          elbowFlexionDeg: elbowFlex,
          side: 'left' as const,
          hipDelta: inActive ? 0.06 : 0,
        } as PushupPoseIntent;
      },
      buildPushupPose,
      { fps: 30, durationMs: CAL_MS + 3 * repCycleMs },
    );

    const result = runPushupSession(frames);

    expect(countWarnings(result, 'hip-sag')).toBeGreaterThan(0);
  });
});
