/**
 * Regression: position-lost fires when no usable landmarks for ≥ 3s (Fix N).
 * Mirrors lunge/17-position-lost.test.ts — same constants, same structure.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames, concatFrames } from '../../harness/frame-stream';
import { buildInchwormPose } from '../../harness/pose-stub';
import { runInchwormSession, countWarnings } from '../../harness/runner';
import type { InchwormPoseIntent, Frame } from '../../harness/types';

function standingFrames(durationMs: number, startAt = 0) {
  return buildFrames(
    (): InchwormPoseIntent => ({ hipHingeDeg: 0 }),
    buildInchwormPose,
    { fps: 30, durationMs, startAt },
  );
}

function nullFrames(durationMs: number, startAt = 0): Frame[] {
  const frames: Frame[] = [];
  const dt = 1000 / 30;
  for (let t = 0; t < durationMs; t += dt) {
    frames.push({ landmarks: null, tMs: startAt + t });
  }
  return frames;
}

describe('Inchworm — position-lost detection (Fix N)', () => {
  it('fires position-lost after 3s of no visible landmarks post-calibration', () => {
    const calFrames = standingFrames(500);
    const lostFrames = nullFrames(4000);
    const frames = concatFrames(calFrames, lostFrames);
    const result = runInchwormSession(frames);

    expect(countWarnings(result, 'position-lost')).toBeGreaterThanOrEqual(1);
  });

  it('does NOT fire position-lost if landmarks return within 3s', () => {
    const calFrames = standingFrames(500);
    const lostFrames = nullFrames(1500);
    const backFrames = standingFrames(500);
    const frames = concatFrames(calFrames, lostFrames, backFrames);
    const result = runInchwormSession(frames);

    expect(countWarnings(result, 'position-lost')).toBe(0);
  });

  it('does NOT fire position-lost before calibration confirms', () => {
    const frames: Frame[] = [];
    for (let t = 0; t < 5000; t += 33) {
      frames.push({ landmarks: null, tMs: t });
    }
    const result = runInchwormSession(frames);
    expect(countWarnings(result, 'position-lost')).toBe(0);
  });

  it('respects the 10s repeat cooldown', () => {
    const calFrames = standingFrames(500);
    const lostFrames = nullFrames(12000);
    const frames = concatFrames(calFrames, lostFrames);
    const result = runInchwormSession(frames);

    // Fires at ~3s, then again at ~13s — at most 2 in a 12s window
    expect(countWarnings(result, 'position-lost')).toBeLessThanOrEqual(2);
    expect(countWarnings(result, 'position-lost')).toBeGreaterThanOrEqual(1);
  });
});
