/**
 * Regression test for Fix A on Chair Dip: posture warnings
 * (elbow-flare, torso-swing) must NOT fire while the user is resting in
 * EXTENDED between reps. Same bug pattern as bicep-curl/overhead-tricep-extension
 * — the form warnings were ungated and fired every frame after calibration even
 * when the user was just standing there recovering between reps.
 *
 * Fix (engine.ts): gate `maybeEmitWarning('torso-swing' | 'elbow-flare')` to
 * `repState !== 'EXTENDED'`.
 *
 * Test A — elbow-flare held in EXTENDED (elbowFlexionDeg=5): ZERO warnings.
 * Test B — elbow-flare during DIPPING (elbowFlexionDeg > 30): warning DOES fire.
 * Test C — torso-swing held in EXTENDED: ZERO warnings.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildChairDipPose } from '../../harness/pose-stub';
import { runChairDipSession, countWarnings } from '../../harness/runner';
import type { ChairDipPoseIntent } from '../../harness/types';

function dipShoulderDescent(flex: number): number {
  return Math.max(0, Math.min(0.04, (flex - 5) / 85 * 0.04));
}

// Calibration requires feetWidthRatio=1.0 and bodyHeight=0.70 (distanceOk gate)
// in addition to elbowFlexionDeg < 30 (armsExtended gate).
// CONFIRM_DURATION_MS=200ms so 500ms is more than enough to calibrate.
const CAL_MS = 500;

describe('Chair Dip — posture warning gating (only fire when not EXTENDED)', () => {
  it('does NOT fire elbow-flare while user holds EXTENDED with flared elbows', () => {
    // Post-cal: user stays at elbowFlexionDeg=5 (well below ASCEND_START_DEG=30)
    // with a sustained elbow flare of 0.08 (above ELBOW_FLARE_THRESHOLD=0.06).
    // The engine must stay in EXTENDED and suppress the warning entirely.
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) {
          return { elbowFlexionDeg: 5, feetWidthRatio: 1.0, bodyHeight: 0.70 } as ChairDipPoseIntent;
        }
        return {
          elbowFlexionDeg: 5,
          feetWidthRatio: 1.0,
          bodyHeight: 0.70,
          elbowFlareX: 0.08,    // past ELBOW_FLARE_THRESHOLD=0.06
        } as ChairDipPoseIntent;
      },
      buildChairDipPose,
      { fps: 30, durationMs: CAL_MS + 5000 },
    );

    const result = runChairDipSession(frames);

    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'elbow-flare')).toBe(0);
  });

  it('DOES fire elbow-flare once the user enters DIPPING with flared elbows', () => {
    // Perform a full rep cycle. The elbow flare signal is active throughout
    // the dip so it should fire inside DIPPING / AT_BOTTOM / PRESSING.
    const repCycleMs = 4000;
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) {
          return { elbowFlexionDeg: 5, feetWidthRatio: 1.0, bodyHeight: 0.70 } as ChairDipPoseIntent;
        }
        const tInRep = (tMs - CAL_MS) % repCycleMs;
        let elbowFlexionDeg: number;
        // Descend 0→90° over 1.5s, hold briefly, press back to 0° over 1.5s
        if (tInRep < 1500) elbowFlexionDeg = (tInRep / 1500) * 90;
        else if (tInRep < 2000) elbowFlexionDeg = 90;
        else if (tInRep < 3500) elbowFlexionDeg = 90 - ((tInRep - 2000) / 1500) * 90;
        else elbowFlexionDeg = 0;
        const inActive = elbowFlexionDeg > 30;
        return {
          elbowFlexionDeg,
          feetWidthRatio: 1.0,
          bodyHeight: 0.70,
          elbowFlareX: inActive ? 0.08 : 0,
          shoulderDescentY: dipShoulderDescent(elbowFlexionDeg),
        } as ChairDipPoseIntent;
      },
      buildChairDipPose,
      { fps: 30, durationMs: CAL_MS + 2 * repCycleMs },
    );

    const result = runChairDipSession(frames);
    expect(countWarnings(result, 'elbow-flare')).toBeGreaterThan(0);
  });

  it('does NOT fire torso-swing while user holds EXTENDED with bad torso shift', () => {
    // Post-cal: still in EXTENDED (no dip) but with a sustained torso sway.
    // torsoSwayX=0.06 is past TORSO_SWING_THRESHOLD=0.04.
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) {
          return { elbowFlexionDeg: 5, feetWidthRatio: 1.0, bodyHeight: 0.70 } as ChairDipPoseIntent;
        }
        return {
          elbowFlexionDeg: 5,
          feetWidthRatio: 1.0,
          bodyHeight: 0.70,
          torsoSwayX: 0.06,    // past TORSO_SWING_THRESHOLD=0.04
        } as ChairDipPoseIntent;
      },
      buildChairDipPose,
      { fps: 30, durationMs: CAL_MS + 5000 },
    );

    const result = runChairDipSession(frames);

    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'torso-swing')).toBe(0);
  });
});
