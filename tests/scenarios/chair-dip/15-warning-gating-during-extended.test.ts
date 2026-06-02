/**
 * Regression test for Fix A on Chair Dip — warning gating across the full
 * idle period between reps.
 *
 * Mirrors lunge/15-warning-gating-during-standing.test.ts pattern: once the
 * user completes a rep and returns to EXTENDED, any elbow-flare or torso-swing
 * signals present during the 3-second recovery window must be completely
 * suppressed. Only when the user starts the next dip (elbowFlexionDeg > 30)
 * should warnings resume.
 *
 * Test A — sustained elbow-flare (elbowFlareX=0.08) during the rest phase
 *           between two reps should produce ZERO elbow-flare warnings.
 * Test B — same verification for torso-swing: swayX=0.06 during rest should
 *           produce ZERO torso-swing warnings.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames, concatFrames } from '../../harness/frame-stream';
import { buildChairDipPose } from '../../harness/pose-stub';
import { runChairDipSession, countWarnings } from '../../harness/runner';
import type { ChairDipPoseIntent } from '../../harness/types';

function dipShoulderDescent(flex: number): number {
  return Math.max(0, Math.min(0.04, (flex - 5) / 85 * 0.04));
}

// Calibration requires feetWidthRatio=1.0 and bodyHeight=0.70.
// CONFIRM_DURATION_MS=200ms so 500ms is more than enough.
const CAL_MS = 500;

/** Build frames representing a clean rep (no elbow flare / torso sway). */
function buildCleanRepFrames(): ReturnType<typeof buildFrames> {
  const repCycleMs = 4000;
  return buildFrames(
    (tMs) => {
      const tInRep = tMs % repCycleMs;
      let elbowFlexionDeg: number;
      if (tInRep < 1500) elbowFlexionDeg = (tInRep / 1500) * 90;
      else if (tInRep < 2000) elbowFlexionDeg = 90;
      else if (tInRep < 3500) elbowFlexionDeg = 90 - ((tInRep - 2000) / 1500) * 90;
      else elbowFlexionDeg = 0;
      return {
        elbowFlexionDeg,
        feetWidthRatio: 1.0,
        bodyHeight: 0.70,
        shoulderDescentY: dipShoulderDescent(elbowFlexionDeg),
      } as ChairDipPoseIntent;
    },
    buildChairDipPose,
    { fps: 30, durationMs: repCycleMs },
  );
}

describe('Chair Dip — warning gating during idle rest phase between reps', () => {
  it('does NOT fire elbow-flare during the 3-second rest phase between two reps', () => {
    // Sequence:
    //   0–2200ms  calibration (elbowFlexionDeg=5, clean)
    //   2200ms    one clean rep
    //   after rep: 3 seconds in EXTENDED with elbowFlareX=0.08 (rest phase)
    //   no second rep
    const calFrames = buildFrames(
      () => ({ elbowFlexionDeg: 5, feetWidthRatio: 1.0, bodyHeight: 0.70 } as ChairDipPoseIntent),
      buildChairDipPose,
      { fps: 30, durationMs: CAL_MS },
    );

    const repFrames = buildCleanRepFrames();

    // Rest phase: still in EXTENDED, elbow flare present
    const restFrames = buildFrames(
      () => ({
        elbowFlexionDeg: 5,
        feetWidthRatio: 1.0,
        bodyHeight: 0.70,
        elbowFlareX: 0.08,    // above ELBOW_FLARE_THRESHOLD=0.06
      } as ChairDipPoseIntent),
      buildChairDipPose,
      { fps: 30, durationMs: 3000 },
    );

    const frames = concatFrames(calFrames, repFrames, restFrames);
    const result = runChairDipSession(frames);

    expect(result.finalCalibration?.state).toBe('confirmed');
    // Elbow flare was only present in EXTENDED (rest) — must be zero
    expect(countWarnings(result, 'elbow-flare')).toBe(0);
  });

  it('does NOT fire torso-swing during the 3-second rest phase between two reps', () => {
    // Same structure as above but with torso sway instead of elbow flare.
    const calFrames = buildFrames(
      () => ({ elbowFlexionDeg: 5, feetWidthRatio: 1.0, bodyHeight: 0.70 } as ChairDipPoseIntent),
      buildChairDipPose,
      { fps: 30, durationMs: CAL_MS },
    );

    const repFrames = buildCleanRepFrames();

    // Rest phase: still in EXTENDED, torso sway present
    const restFrames = buildFrames(
      () => ({
        elbowFlexionDeg: 5,
        feetWidthRatio: 1.0,
        bodyHeight: 0.70,
        torsoSwayX: 0.06,    // above TORSO_SWING_THRESHOLD=0.04
      } as ChairDipPoseIntent),
      buildChairDipPose,
      { fps: 30, durationMs: 3000 },
    );

    const frames = concatFrames(calFrames, repFrames, restFrames);
    const result = runChairDipSession(frames);

    expect(result.finalCalibration?.state).toBe('confirmed');
    // Torso swing was only present in EXTENDED (rest) — must be zero
    expect(countWarnings(result, 'torso-swing')).toBe(0);
  });
});
