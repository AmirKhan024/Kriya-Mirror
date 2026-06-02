/**
 * Box Jump — warning gating during STANDING state.
 *
 * Form warnings (stiff-landing) must NOT fire when repState = 'STANDING'.
 * This covers Fix A — no warning spam between reps.
 *
 * kneeAngleDeg=175 → kneeFlexionDeg≈2.5° (nearly straight, stiff-looking)
 * but in STANDING state → Fix A prevents stiff-landing from firing.
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

describe('Box Jump — warning gating during STANDING', () => {
  it('stiff-landing not emitted when standing still with straight legs (no active rep)', () => {
    // After calibration, stand still with kneeAngleDeg=175 (stiff-looking straight legs)
    // repState = STANDING → stiff-landing must not fire (Fix A)
    const postCalFrames = buildFrames(
      () => ({ hipYOffset: 0, kneeAngleDeg: 175 } satisfies BoxJumpPoseIntent),
      buildBoxJumpPose,
      { fps: 30, durationMs: 3000 },
    );
    const frames: Frame[] = concatFrames(calFrames(), postCalFrames);
    const result = runBoxJumpSession(frames);

    expect(result.completedReps.length).toBe(0);
    expect(countWarnings(result, 'stiff-landing')).toBe(0);
  });

  it('not-moving fires after 5s of inactivity (not gated by rep state)', () => {
    const idleFrames = buildFrames(
      () => ({ hipYOffset: 0, kneeAngleDeg: 170 } satisfies BoxJumpPoseIntent),
      buildBoxJumpPose,
      { fps: 30, durationMs: 6000 },
    );
    const frames: Frame[] = concatFrames(calFrames(), idleFrames);
    const result = runBoxJumpSession(frames);

    expect(countWarnings(result, 'not-moving')).toBeGreaterThanOrEqual(1);
  });
});
