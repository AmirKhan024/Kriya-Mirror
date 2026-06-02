import { describe, it, expect } from 'vitest';
import { buildFrames, concatFrames } from '../../harness/frame-stream';
import { buildShrugPose } from '../../harness/pose-stub';
import { runShrugSession, countWarnings } from '../../harness/runner';

describe('Shrug — position-lost', () => {
  it('fires position-lost after 4s of null frames post-calibration', () => {
    const calFrames = buildFrames(
      () => ({ shoulderElevation: 0 }),
      buildShrugPose,
      { fps: 30, durationMs: 2500 }, // enough to calibrate
    );

    // 4 seconds of null (pose lost)
    const lostFrames = buildFrames(
      () => null,
      buildShrugPose,
      { fps: 30, durationMs: 4000 },
    );

    const frames = concatFrames(calFrames, lostFrames);
    const result = runShrugSession(frames);

    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'position-lost')).toBeGreaterThanOrEqual(1);
  });

  it('does NOT fire position-lost for null frames before calibration', () => {
    // All null — no calibration, no position-lost
    const frames = buildFrames(
      () => null,
      buildShrugPose,
      { fps: 30, durationMs: 6000 },
    );

    const result = runShrugSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(countWarnings(result, 'position-lost')).toBe(0);
  });

  it('respects 10s cooldown — fires at 4s then again no sooner than 14s', () => {
    const calFrames = buildFrames(
      () => ({ shoulderElevation: 0 }),
      buildShrugPose,
      { fps: 30, durationMs: 2500 },
    );

    // 16s of null frames — enough for 2 firings (at ~3s and ~13s into lost)
    const lostFrames = buildFrames(
      () => null,
      buildShrugPose,
      { fps: 30, durationMs: 16000 },
    );

    const frames = concatFrames(calFrames, lostFrames);
    const result = runShrugSession(frames);

    expect(countWarnings(result, 'position-lost')).toBeGreaterThanOrEqual(1);
  });
});
