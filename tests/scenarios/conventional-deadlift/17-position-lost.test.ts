/**
 * Conventional Deadlift — position-lost detection (Fix N).
 * After 3s without usable core landmarks post-calibration, fires position-lost.
 * Repeats no faster than every 10s.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames, concatFrames } from '../../harness/frame-stream';
import { buildDeadliftPose } from '../../harness/pose-stub';
import { runDeadliftSession, countWarnings } from '../../harness/runner';
import type { Frame } from '../../harness/types';
import type { DeadliftPoseIntent } from '../../harness/types';

function standingFrames(durationMs: number, startAt = 0) {
  return buildFrames(
    (): DeadliftPoseIntent => ({ hipHingeDeg: 0, armsAtSides: true }),
    buildDeadliftPose,
    { fps: 30, durationMs, startAt },
  );
}

function nullFrames(durationMs: number, startAt = 0): Frame[] {
  const fps = 30;
  const dt = 1000 / fps;
  const frames: Frame[] = [];
  for (let t = 0; t < durationMs; t += dt) {
    frames.push({ landmarks: null, tMs: startAt + t });
  }
  return frames;
}

describe('Conventional Deadlift — position-lost (Fix N)', () => {
  it('fires position-lost after 3s of null landmarks post-calibration', () => {
    const calFrames = standingFrames(1000);
    const lostFrames = nullFrames(4500);
    const frames = concatFrames(calFrames, lostFrames);
    const result = runDeadliftSession(frames);

    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'position-lost')).toBeGreaterThan(0);
  });

  it('does NOT fire position-lost if landmarks return within 3s', () => {
    const calFrames = standingFrames(1000);
    // 1s of null (< 3s threshold), then landmarks return
    const briefLostFrames = nullFrames(1000);
    const returnFrames = standingFrames(3000);
    const frames = concatFrames(calFrames, briefLostFrames, returnFrames);
    const result = runDeadliftSession(frames);

    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'position-lost')).toBe(0);
  });

  it('fires at most once per 10s (repeat guard)', () => {
    const calFrames = standingFrames(1000);
    // 14s of null — should fire once (at ~3s) then again at ~13s (10s repeat)
    const lostFrames = nullFrames(14000);
    const frames = concatFrames(calFrames, lostFrames);
    const result = runDeadliftSession(frames);

    // At most 2 fires: one at ~3s, one at ~13s. Never fires immediately every frame.
    const posLostCount = countWarnings(result, 'position-lost');
    expect(posLostCount).toBeGreaterThan(0);
    expect(posLostCount).toBeLessThanOrEqual(2);
  });
});
