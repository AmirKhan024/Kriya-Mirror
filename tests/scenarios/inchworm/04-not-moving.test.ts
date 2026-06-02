/**
 * Inchworm — not-moving (idle) detection.
 * Fix P (cold-start cooldown) and Fix O (EMA reseed) patterns.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames, concatFrames } from '../../harness/frame-stream';
import { buildInchwormPose } from '../../harness/pose-stub';
import { runInchwormSession, countWarnings } from '../../harness/runner';
import type { InchwormPoseIntent } from '../../harness/types';

function standingFrames(durationMs: number) {
  return buildFrames(
    (): InchwormPoseIntent => ({ hipHingeDeg: 0 }),
    buildInchwormPose,
    { fps: 30, durationMs },
  );
}

describe('Inchworm — not-moving detection', () => {
  it('fires not-moving after 5s of standing still post-calibration', () => {
    const calFrames = standingFrames(500);
    // 6s of no movement — should trigger not-moving at ~5s mark
    const idleFrames = standingFrames(6500);
    const frames = concatFrames(calFrames, idleFrames);
    const result = runInchwormSession(frames);

    expect(countWarnings(result, 'not-moving')).toBeGreaterThanOrEqual(1);
  });

  it('does NOT fire not-moving immediately after calibration confirms (Fix P)', () => {
    // Only 2s of standing — under the 5s NO_MOVEMENT_TIMEOUT_MS
    const frames = concatFrames(standingFrames(500), standingFrames(2000));
    const result = runInchwormSession(frames);
    expect(countWarnings(result, 'not-moving')).toBe(0);
  });

  it('does NOT fire not-moving during active rep', () => {
    const calFrames = standingFrames(500);
    // Rep that occupies 4s (under the 5s idle threshold)
    const repFrames = buildFrames(
      (tMs): InchwormPoseIntent => {
        if (tMs < 1200) return { hipHingeDeg: (tMs / 1200) * 65 };
        if (tMs < 1800) return { hipHingeDeg: 65 };
        return { hipHingeDeg: 65 - ((tMs - 1800) / 1200) * 65 };
      },
      buildInchwormPose,
      { fps: 30, durationMs: 4000 },
    );
    const frames = concatFrames(calFrames, repFrames);
    const result = runInchwormSession(frames);
    // A complete rep may or may not fire — but not-moving should not fire
    // while the rep state is active
    expect(countWarnings(result, 'not-moving')).toBe(0);
  });

  it('fires not-moving at most once per 15s repeat window', () => {
    const calFrames = standingFrames(500);
    // 22s of standing — should fire at ~5s, then be blocked until ~20s
    const idleFrames = standingFrames(22_000);
    const frames = concatFrames(calFrames, idleFrames);
    const result = runInchwormSession(frames);

    // At most 2 fires in ~22s window (one at ~5s, one at ~20s)
    expect(countWarnings(result, 'not-moving')).toBeLessThanOrEqual(2);
    expect(countWarnings(result, 'not-moving')).toBeGreaterThanOrEqual(1);
  });
});
