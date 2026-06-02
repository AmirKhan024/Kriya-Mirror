import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildOTEPose } from '../../harness/pose-stub';
import { runOTESession, countWarnings } from '../../harness/runner';

/**
 * Fix N regression: after calibration confirms, if no usable pose landmarks
 * arrive for ≥ 3s, the engine must emit `position-lost`. It should repeat at
 * most once every 10s.
 */
describe('Overhead Tricep Extension — position-lost (Fix N)', () => {
  it('fires position-lost after 4s of null frames post-calibration', () => {
    // 2.2s good frames then 5s of null landmarks (frames with no pose)
    const calFrames = buildFrames(
      () => ({ extensionLevel: 1.0 }),
      buildOTEPose,
      { fps: 30, durationMs: 2200 },
    );
    const nullFrames: { tMs: number; landmarks: null }[] = [];
    for (let t = 2200; t < 7200; t += 33) {
      nullFrames.push({ tMs: t, landmarks: null });
    }

    const result = runOTESession([...calFrames, ...nullFrames]);

    expect(result.calibrationConfirmedAtMs).not.toBeNull();
    expect(countWarnings(result, 'position-lost')).toBeGreaterThanOrEqual(1);
    // Should fire at or after 3s post-calibration
    const lostWarning = result.warnings.find((w) => w.type === 'position-lost');
    expect(lostWarning!.atMs).toBeGreaterThanOrEqual(2200 + 3000);
  });

  it('does NOT fire position-lost during a clean stream of landmarks', () => {
    const frames = buildFrames(
      () => ({ extensionLevel: 1.0 }),
      buildOTEPose,
      { fps: 30, durationMs: 8000 },
    );

    const result = runOTESession(frames);

    expect(countWarnings(result, 'position-lost')).toBe(0);
  });

  it('fires position-lost at most once per 10s cooldown', () => {
    // 2.2s good frames then 25s of null landmarks
    const calFrames = buildFrames(
      () => ({ extensionLevel: 1.0 }),
      buildOTEPose,
      { fps: 30, durationMs: 2200 },
    );
    const nullFrames: { tMs: number; landmarks: null }[] = [];
    for (let t = 2200; t < 28000; t += 33) {
      nullFrames.push({ tMs: t, landmarks: null });
    }

    const result = runOTESession([...calFrames, ...nullFrames]);

    // In 25s of null frames: first fire at ~5200ms, second fire at ~15200ms, third at ~25200ms
    // → at most 3 fires. Must not fire every frame.
    const lostCount = countWarnings(result, 'position-lost');
    expect(lostCount).toBeGreaterThanOrEqual(1);
    expect(lostCount).toBeLessThanOrEqual(4);
  });
});
