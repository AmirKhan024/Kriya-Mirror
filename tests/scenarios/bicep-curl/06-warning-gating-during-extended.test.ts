/**
 * Regression test for round-5 Fix A on Bicep Curl: posture warnings
 * (torso-swing, elbow-drift) must NOT fire while the user is resting in
 * EXTENDED between reps. Same bug pattern as squat/lunge/pushup — the form
 * warnings were ungated and fired every frame after calibration even when
 * the user was just standing there recovering between reps.
 *
 * Fix (engine.ts): gate `maybeEmitWarning('torso-swing' | 'elbow-drift')` to
 * `repState !== 'EXTENDED'`.
 *
 * This test holds the user in EXTENDED with a sustained torso sway and
 * asserts ZERO torso-swing warnings for 5 seconds. Then it runs a real rep
 * with the same bad signal during CURLING and asserts the warning DOES fire.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildBicepCurlPose } from '../../harness/pose-stub';
import { runBicepCurlSession, countWarnings } from '../../harness/runner';
import type { BicepCurlPoseIntent } from '../../harness/types';

const CAL_MS = 2200;

describe('Bicep Curl — posture warning gating (only fire when not EXTENDED)', () => {
  it('does NOT fire torso-swing while user holds EXTENDED with bad form', () => {
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) {
          return { elbowFlexionDeg: 0 } as BicepCurlPoseIntent;
        }
        // Post-cal: still in EXTENDED (no curl) but with a sustained torso sway.
        // NOTE: we deliberately do NOT use elbowDriftX here — shifting the
        // elbow/wrist without shifting the shoulder creates a fake elbow-flex
        // angle that would trip the state machine out of EXTENDED, defeating
        // the test. Torso-sway shifts the whole upper body so flex stays 0.
        return {
          elbowFlexionDeg: 0,
          torsoSwayX: 0.06,    // past TORSO_SWING_THRESHOLD=0.04
        } as BicepCurlPoseIntent;
      },
      buildBicepCurlPose,
      { fps: 30, durationMs: CAL_MS + 5000 },
    );

    const result = runBicepCurlSession(frames);

    expect(countWarnings(result, 'torso-swing')).toBe(0);
    expect(countWarnings(result, 'elbow-drift')).toBe(0);
  });

  it('DOES fire torso-swing once the user enters CURLING with bad form', () => {
    const repCycleMs = 3000;
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) {
          return { elbowFlexionDeg: 0 } as BicepCurlPoseIntent;
        }
        const tInRep = (tMs - CAL_MS) % repCycleMs;
        let elbowFlexionDeg: number;
        if (tInRep < 1000) elbowFlexionDeg = (tInRep / 1000) * 130;
        else if (tInRep < 1500) elbowFlexionDeg = 130;
        else if (tInRep < 2500) elbowFlexionDeg = 130 - ((tInRep - 1500) / 1000) * 130;
        else elbowFlexionDeg = 0;
        const inActive = elbowFlexionDeg > 30;
        return {
          elbowFlexionDeg,
          torsoSwayX: inActive ? 0.06 : 0,
        } as BicepCurlPoseIntent;
      },
      buildBicepCurlPose,
      { fps: 30, durationMs: CAL_MS + 2 * repCycleMs },
    );

    const result = runBicepCurlSession(frames);
    expect(countWarnings(result, 'torso-swing')).toBeGreaterThan(0);
  });
});
