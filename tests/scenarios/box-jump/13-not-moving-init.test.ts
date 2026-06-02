/**
 * Box Jump — not-moving on initial idle (Fix I + Fix P).
 *
 * After calibration confirm, if user stands still for >5s, 'not-moving' fires.
 * The cold-start cooldown (Fix P): lastNoMovementWarnAt=0 → first fire allowed immediately.
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

describe('Box Jump — not-moving init', () => {
  it('not-moving fires after 5s of standing still post-calibration', () => {
    const idleFrames = buildFrames(
      () => ({ hipYOffset: 0, kneeAngleDeg: 170 } satisfies BoxJumpPoseIntent),
      buildBoxJumpPose,
      { fps: 30, durationMs: 6000 },
    );
    const frames = concatFrames(calFrames(), idleFrames);
    const result = runBoxJumpSession(frames);

    expect(countWarnings(result, 'not-moving')).toBeGreaterThanOrEqual(1);
  });

  it('not-moving does NOT fire within first 5s post-calibration', () => {
    const shortIdleFrames = buildFrames(
      () => ({ hipYOffset: 0, kneeAngleDeg: 170 } satisfies BoxJumpPoseIntent),
      buildBoxJumpPose,
      { fps: 30, durationMs: 4000 },
    );
    const frames = concatFrames(calFrames(), shortIdleFrames);
    const result = runBoxJumpSession(frames);

    // Within 4.8s total, not-moving should not have fired yet
    expect(countWarnings(result, 'not-moving')).toBe(0);
  });

  it('not-moving fires no earlier than ~5s after calibration', () => {
    const idleFrames = buildFrames(
      () => ({ hipYOffset: 0, kneeAngleDeg: 170 } satisfies BoxJumpPoseIntent),
      buildBoxJumpPose,
      { fps: 30, durationMs: 6000 },
    );
    const frames: Frame[] = concatFrames(calFrames(), idleFrames);
    const result = runBoxJumpSession(frames);

    const calMs = result.calibrationConfirmedAtMs ?? 0;
    const firstNotMoving = result.warnings.find((w) => w.type === 'not-moving');
    expect(firstNotMoving).toBeDefined();
    if (firstNotMoving) {
      const idleFor = firstNotMoving.atMs - calMs;
      expect(idleFor).toBeGreaterThanOrEqual(4900); // ~5s
    }
  });
});
