/**
 * Star Jump — not-moving idle warning (Fix I + P).
 *
 * The idle tracker initialises on calibration confirm (Fix §3.7).
 * The first `not-moving` warning should fire at ~5s of idle post-calibration,
 * not immediately on first frame (Fix P: cold-start sentinel).
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildStarJumpPose } from '../../harness/pose-stub';
import { runStarJumpSession, countWarnings } from '../../harness/runner';

const CAL_MS = 300;

describe('Star Jump — not-moving idle warning (cold-start)', () => {
  it('fires not-moving after 5s of idle post-calibration', () => {
    // Calibrate for 300ms (arms at sides), then stay idle for 7s.
    // not-moving should fire at least once after the 5s threshold.
    const IDLE_MS = 7000;
    const frames = buildFrames(
      () => ({ armRaiseDeg: 0, feetSpreadRatio: 1.0 }),
      buildStarJumpPose,
      { fps: 30, durationMs: CAL_MS + IDLE_MS },
    );

    const result = runStarJumpSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'not-moving')).toBeGreaterThanOrEqual(1);
  });

  it('does NOT fire not-moving within 4s of calibration', () => {
    // Idle for only 4s — should not have reached the 5s (NO_MOVEMENT_TIMEOUT_MS) threshold.
    const frames = buildFrames(
      () => ({ armRaiseDeg: 0, feetSpreadRatio: 1.0 }),
      buildStarJumpPose,
      { fps: 30, durationMs: CAL_MS + 4000 },
    );

    const result = runStarJumpSession(frames);
    expect(countWarnings(result, 'not-moving')).toBe(0);
  });

  it('does NOT fire not-moving immediately on calibration-confirm frame (Fix P)', () => {
    // Only feed enough frames to confirm calibration (~300ms). The engine must NOT
    // fire 'not-moving' on the very first post-calibration frame — Fix P ensures
    // the cold-start sentinel prevents this.
    const frames = buildFrames(
      () => ({ armRaiseDeg: 0, feetSpreadRatio: 1.0 }),
      buildStarJumpPose,
      { fps: 30, durationMs: CAL_MS + 100 },
    );

    const result = runStarJumpSession(frames);
    expect(countWarnings(result, 'not-moving')).toBe(0);
  });
});
