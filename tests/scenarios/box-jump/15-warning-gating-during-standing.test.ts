/**
 * Box Jump — all form warnings silent in STANDING state.
 *
 * stiff-landing is gated to active rep (repState !== 'STANDING').
 * no-loading and incomplete-jump are emitted at rep completion, not per-frame.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames, concatFrames } from '../../harness/frame-stream';
import { buildBoxJumpPose } from '../../harness/pose-stub';
import { runBoxJumpSession } from '../../harness/runner';
import type { BoxJumpPoseIntent, Frame } from '../../harness/types';

function calFrames(): Frame[] {
  return buildFrames(
    () => ({ hipYOffset: 0, kneeAngleDeg: 170 } satisfies BoxJumpPoseIntent),
    buildBoxJumpPose,
    { fps: 30, durationMs: 800 },
  );
}

describe('Box Jump — form warnings silent in STANDING state', () => {
  it('no stiff-landing warning during standing phase with straight legs (Fix A)', () => {
    // Standing with nearly-straight legs for 3s (kneeAngleDeg=175 → flexion≈2.5°)
    // but repState = STANDING → stiff-landing must NOT fire
    const standingFrames = buildFrames(
      () => ({ hipYOffset: 0, kneeAngleDeg: 175 } satisfies BoxJumpPoseIntent),
      buildBoxJumpPose,
      { fps: 30, durationMs: 3000 },
    );
    const frames: Frame[] = concatFrames(calFrames(), standingFrames);
    const result = runBoxJumpSession(frames);

    const formWarnings = result.warnings.filter(
      (w) => w.type === 'stiff-landing',
    );
    expect(formWarnings.length).toBe(0);
    expect(result.completedReps.length).toBe(0);
  });

  it('only position-valid warnings (not-moving) fire during idle standing', () => {
    const longStandFrames = buildFrames(
      () => ({ hipYOffset: 0, kneeAngleDeg: 170 } satisfies BoxJumpPoseIntent),
      buildBoxJumpPose,
      { fps: 30, durationMs: 6000 },
    );
    const frames: Frame[] = concatFrames(calFrames(), longStandFrames);
    const result = runBoxJumpSession(frames);

    const formWarnings = result.warnings.filter(
      (w) => w.type === 'stiff-landing' || w.type === 'no-loading' || w.type === 'incomplete-jump',
    );
    expect(formWarnings.length).toBe(0);
  });
});
