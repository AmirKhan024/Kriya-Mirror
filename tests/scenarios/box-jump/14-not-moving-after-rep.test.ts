/**
 * Box Jump — not-moving after a rep (Fix O: EMA-decay reseed).
 *
 * After completing a rep, the EMA decay tail would normally prevent the
 * not-moving idle window from starting cleanly. Fix O reseeds the standing
 * baseline after the EMA settles for 500ms. This test verifies that
 * not-moving fires correctly after the rep is done and the user idles.
 *
 * Rep cycle: 1800ms. After rep, idle 8s → not-moving should fire.
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

function oneRepFrames(): Frame[] {
  return buildFrames(
    (tMs): BoxJumpPoseIntent => {
      if (tMs < 200) return { hipYOffset: 0.06,  kneeAngleDeg: 130 };  // load
      if (tMs < 500) return { hipYOffset: -0.12, kneeAngleDeg: 170 };  // airborne
      if (tMs < 800) return { hipYOffset: -0.06, kneeAngleDeg: 90 };   // on-box absorption
      return { hipYOffset: 0, kneeAngleDeg: 170 };                      // stand
    },
    buildBoxJumpPose,
    { fps: 30, durationMs: 1800 },
  );
}

describe('Box Jump — not-moving after rep (Fix O)', () => {
  it('not-moving fires after user completes a rep and idles for 8s', () => {
    const longIdleFrames = buildFrames(
      () => ({ hipYOffset: 0, kneeAngleDeg: 170 } satisfies BoxJumpPoseIntent),
      buildBoxJumpPose,
      { fps: 30, durationMs: 9000 },
    );
    const frames = concatFrames(calFrames(), oneRepFrames(), longIdleFrames);
    const result = runBoxJumpSession(frames);

    expect(result.completedReps.length).toBeGreaterThanOrEqual(1);
    // After the rep, if user idles 8s, not-moving should fire
    expect(countWarnings(result, 'not-moving')).toBeGreaterThanOrEqual(1);
  });

  it('not-moving does not fire during the rep itself', () => {
    // Only do the rep, no long idle after (total time = cal + rep = ~2.6s < 5s idle window)
    const frames = concatFrames(calFrames(), oneRepFrames());
    const result = runBoxJumpSession(frames);

    expect(result.completedReps.length).toBeGreaterThanOrEqual(1);
    expect(countWarnings(result, 'not-moving')).toBe(0);
  });
});
