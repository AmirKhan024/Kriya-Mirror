/**
 * Regression test for Chair Dip Fix O — EMA-decay reseed after a real rep.
 *
 * Bug: after a complete rep, smoothedFlexion decays exponentially from the rep
 * peak (~90°) back toward the resting value (~5°) over several seconds. This
 * decay permanently inflates (extendedFlexionMax - extendedFlexionMin), so the
 * variance never closes back below NO_MOVEMENT_VARIANCE_DEG (2°), and
 * 'not-moving' never fires — even when the user is genuinely standing still.
 *
 * Fix (engine.ts, §extendedBaselineReseeded): once the per-frame EMA change
 * has been under 0.3° for 500ms straight, drop the cached min/max and reseed
 * from the current smoothedFlexion value so the variance accumulator reflects
 * only true post-settle jitter.
 *
 * Test verifies the fix is in place for Chair Dip by running:
 *   1. Calibrate
 *   2. Complete ONE valid rep (flex 5 → 90 → 5 over 3s)
 *   3. Rest in EXTENDED (flex=5) for 8s
 *   4. Assert 'not-moving' fires during the idle window
 *
 * Constants from engine.ts:
 *   EMA_ALPHA_ELBOW        = 0.15
 *   ASCEND_START_DEG       = 30   (engine enters DIPPING above this)
 *   EXTENDED_THRESHOLD_DEG = 25   (rep complete when flex drops below this)
 *   MIN_REP_DEPTH_DEG      = 60   (valid rep must reach ≥60° avg flex)
 *   NO_MOVEMENT_TIMEOUT_MS = 5000
 *   NO_MOVEMENT_VARIANCE_DEG = 2
 */
import { describe, it, expect } from 'vitest';
import { buildFrames, concatFrames } from '../../harness/frame-stream';
import { buildChairDipPose } from '../../harness/pose-stub';
import { runChairDipSession, countWarnings } from '../../harness/runner';
import type { ChairDipPoseIntent } from '../../harness/types';

function dipShoulderDescent(flex: number): number {
  return Math.max(0, Math.min(0.04, (flex - 5) / 85 * 0.04));
}

describe('Chair Dip — regression: not-moving fires after a real rep + idle (Fix O)', () => {
  it('DOES fire not-moving when user rests in EXTENDED after completing a rep', () => {
    // Segment 1: calibration — 400ms of all-green frames at flex=5.
    const calDurationMs = 400;

    // Segment 2: one complete rep — flex ramps 5 → 90 over 1.5s, holds 90
    // for 0.5s, then presses back 90 → 5 over 1.5s. Total rep: 3.5s.
    // avg bilateral flex mirrors these values (same flex for both arms).
    const repDurationMs = 3500;

    // Segment 3: idle in EXTENDED — hold flex=5 for 8s.
    // The EMA-decay reseed should activate ~500ms after the EMA settles, then
    // after 5s of settled variance < 2°, not-moving fires.
    const idleDurationMs = 8000;

    const totalMs = calDurationMs + repDurationMs + idleDurationMs;

    const frames = buildFrames(
      (tMs) => {
        if (tMs < calDurationMs) {
          // Calibration: arms extended at sides
          return { elbowFlexionDeg: 5, feetWidthRatio: 1.0, bodyHeight: 0.70 } as ChairDipPoseIntent;
        }

        const tInRep = tMs - calDurationMs;
        if (tInRep < repDurationMs) {
          // Rep: dip down to 90°, hold, press back up
          let elbowFlexionDeg: number;
          if (tInRep < 1500) {
            // Descending: 5 → 90 over 1.5s
            elbowFlexionDeg = 5 + (tInRep / 1500) * 85;
          } else if (tInRep < 2000) {
            // Bottom hold: flex = 90
            elbowFlexionDeg = 90;
          } else {
            // Pressing back: 90 → 5 over 1.5s
            elbowFlexionDeg = 90 - ((tInRep - 2000) / 1500) * 85;
          }
          return {
            elbowFlexionDeg,
            feetWidthRatio: 1.0,
            bodyHeight: 0.70,
            shoulderDescentY: dipShoulderDescent(elbowFlexionDeg),
          } as ChairDipPoseIntent;
        }

        // Post-rep idle: arms at sides, fully extended
        return { elbowFlexionDeg: 5, feetWidthRatio: 1.0, bodyHeight: 0.70 } as ChairDipPoseIntent;
      },
      buildChairDipPose,
      { fps: 30, durationMs: totalMs },
    );

    const result = runChairDipSession(frames);

    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).not.toBeNull();
    expect(result.calibrationConfirmedAtMs!).toBeLessThan(500);

    // At least one rep must have been counted (validates the rep path was taken)
    expect(result.completedReps.length).toBeGreaterThanOrEqual(1);

    // The core assertion: without Fix O the EMA decay tail prevents not-moving
    // from ever firing after a rep. With Fix O it must fire during the 8s idle.
    expect(countWarnings(result, 'not-moving')).toBeGreaterThanOrEqual(1);
  });
});
