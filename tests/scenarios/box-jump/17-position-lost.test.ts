/**
 * Box Jump — position-lost detection (Fix N).
 *
 * Tests:
 *   - After calibration, null landmarks for >3s → 'position-lost' fires
 *   - Cooldown: second fire respects POSITION_LOST_REPEAT_MS = 10s
 *   - Landmarks restored immediately → position-lost stops firing
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

function nullFrames(durationMs: number): Frame[] {
  return buildFrames(
    () => null,
    buildBoxJumpPose,
    { fps: 30, durationMs },
  );
}

function standingFrames(durationMs: number): Frame[] {
  return buildFrames(
    () => ({ hipYOffset: 0, kneeAngleDeg: 170 } satisfies BoxJumpPoseIntent),
    buildBoxJumpPose,
    { fps: 30, durationMs },
  );
}

describe('Box Jump — position-lost (Fix N)', () => {
  it('position-lost fires after >3s of null landmarks post-calibration', () => {
    // 1s of good standing, then 4s of null
    const frames = concatFrames(
      calFrames(),
      standingFrames(1000),
      nullFrames(4000),
    );
    const result = runBoxJumpSession(frames);
    expect(countWarnings(result, 'position-lost')).toBeGreaterThanOrEqual(1);
  });

  it('position-lost does NOT fire within the first 3s of null frames', () => {
    const frames = concatFrames(
      calFrames(),
      standingFrames(500),
      nullFrames(2500), // < 3s of null
    );
    const result = runBoxJumpSession(frames);
    expect(countWarnings(result, 'position-lost')).toBe(0);
  });

  it('position-lost fires only once per cooldown window (10s repeat)', () => {
    // 4s null → fires once. Then 5s more null (total 9s) → should NOT fire again.
    const frames = concatFrames(
      calFrames(),
      standingFrames(500),
      nullFrames(9000), // 9s total null — second fire needs 10s cooldown
    );
    const result = runBoxJumpSession(frames);
    // Exactly one fire in the 9s window
    expect(countWarnings(result, 'position-lost')).toBe(1);
  });

  it('restoring landmarks stops position-lost from firing again', () => {
    // 4s null → fires. Then good frames restore. No second fire.
    const frames = concatFrames(
      calFrames(),
      standingFrames(500),
      nullFrames(4000),
      standingFrames(2000), // landmarks restored
    );
    const result = runBoxJumpSession(frames);
    expect(countWarnings(result, 'position-lost')).toBe(1);
  });

  it('position-lost does NOT fire before calibration confirm', () => {
    // Just null frames — calibration never confirms so tracking never starts
    const frames = nullFrames(5000);
    const result = runBoxJumpSession(frames);
    expect(countWarnings(result, 'position-lost')).toBe(0);
  });
});
