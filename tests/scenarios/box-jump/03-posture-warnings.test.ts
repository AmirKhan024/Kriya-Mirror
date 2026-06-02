/**
 * Box Jump — posture warnings.
 *
 * Tests:
 *   - stiff-landing fires when knee stays near-straight for >300ms after landing
 *   - stiff-landing is gated to active rep (Fix A)
 *
 * Geometry notes (buildBoxJumpPose):
 *   kneeAngleDeg represents the INCLUDED angle at the knee (not flexion).
 *   kneeAngleDeg=175 → included angle 175° → nearly straight → kneeFlexionDeg ≈ 2.5° (STIFF)
 *   kneeAngleDeg=90  → included angle 90°  → right angle    → kneeFlexionDeg ≈ 39° (GOOD absorption)
 *   STIFF_LANDING_THRESHOLD = 20° of flexion → fires when flexion < 20° (nearly straight).
 */
import { describe, it, expect } from 'vitest';
import { buildFrames, concatFrames } from '../../harness/frame-stream';
import { buildBoxJumpPose } from '../../harness/pose-stub';
import { runBoxJumpSession, countWarnings } from '../../harness/runner';
import type { BoxJumpPoseIntent, Frame } from '../../harness/types';

function calFrames(): Frame[] {
  return buildFrames(
    () => ({ hipYOffset: 0, kneeAngleDeg: 170 } satisfies BoxJumpPoseIntent),
    buildBoxJumpPose,
    { fps: 30, durationMs: 800 },
  );
}

/**
 * Rep with stiff landing: knee stays nearly straight after landing.
 *
 * Phase breakdown:
 *  - Load (200ms):        hipYOffset=+0.06, kneeAngle=130 (squat dip)
 *  - Airborne (200ms):    hipYOffset=-0.12, kneeAngle=170 (in air)
 *  - Stiff landing (600ms): hipYOffset=-0.06, kneeAngle=175 (on box, stiff legs)
 *    hipYOffset=-0.06 keeps |hipDisp|=0.06>STANDING_TOLERANCE=0.05 → stays in LANDING
 *    kneeFlexionDeg≈2.5° < STIFF_LANDING_THRESHOLD=20° → stiff timer counts
 *    After 300ms → stiff-landing fires
 *  - Return to standing (500ms): hipYOffset=0, kneeAngle=170
 */
function repStiffLandingFrames(): Frame[] {
  return buildFrames(
    (tMs): BoxJumpPoseIntent => {
      if (tMs < 200) return { hipYOffset: 0.06,  kneeAngleDeg: 130 };  // load
      if (tMs < 400) return { hipYOffset: -0.12, kneeAngleDeg: 170 };  // airborne
      if (tMs < 1000) return { hipYOffset: -0.06, kneeAngleDeg: 175 }; // stiff landing (>300ms)
      return { hipYOffset: 0, kneeAngleDeg: 170 };                      // stand
    },
    buildBoxJumpPose,
    { fps: 30, durationMs: 1600 },
  );
}

/**
 * Rep with soft landing: knee bends well on landing.
 * kneeAngleDeg=90 → kneeFlexionDeg≈39° > STIFF_LANDING_THRESHOLD=20° → no stiff timer.
 */
function repSoftLandingFrames(): Frame[] {
  return buildFrames(
    (tMs): BoxJumpPoseIntent => {
      if (tMs < 200) return { hipYOffset: 0.06,  kneeAngleDeg: 130 };  // load
      if (tMs < 400) return { hipYOffset: -0.12, kneeAngleDeg: 170 };  // airborne
      if (tMs < 700) return { hipYOffset: -0.06, kneeAngleDeg: 90 };   // soft landing
      return { hipYOffset: 0, kneeAngleDeg: 170 };                      // stand
    },
    buildBoxJumpPose,
    { fps: 30, durationMs: 1400 },
  );
}

describe('Box Jump — posture warnings', () => {
  it('stiff-landing fires when knee stays straight >300ms after landing', () => {
    const frames = concatFrames(calFrames(), repStiffLandingFrames());
    const result = runBoxJumpSession(frames);

    expect(countWarnings(result, 'stiff-landing')).toBeGreaterThanOrEqual(1);
  });

  it('no stiff-landing warning on soft landing', () => {
    const frames = concatFrames(calFrames(), repSoftLandingFrames());
    const result = runBoxJumpSession(frames);

    expect(countWarnings(result, 'stiff-landing')).toBe(0);
  });

  it('stiff-landing gated to active rep — not fired while in STANDING state (Fix A)', () => {
    // After calibration, stand still with straight legs (kneeAngleDeg=175).
    // repState = STANDING → stiff-landing must NOT fire.
    // kneeFlexionDeg≈2.5° < 20° but Fix A gates it to active rep only.
    const standingStiffFrames = buildFrames(
      () => ({ hipYOffset: 0, kneeAngleDeg: 175 } satisfies BoxJumpPoseIntent),
      buildBoxJumpPose,
      { fps: 30, durationMs: 2000 },
    );
    const frames: Frame[] = concatFrames(calFrames(), standingStiffFrames);
    const result = runBoxJumpSession(frames);

    expect(result.completedReps.length).toBe(0);
    expect(countWarnings(result, 'stiff-landing')).toBe(0);
  });
});
