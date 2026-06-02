/**
 * Clamshell — not-moving init (Fix I + P).
 *
 * After cal-confirm, wait 5.5s in CLOSED with no movement.
 * Assert: 'not-moving' fires exactly once after 5s.
 * Verify: no not-moving fires BEFORE cal-confirm.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildClamshellPose } from '../../harness/pose-stub';
import { runClamshellSession, countWarnings } from '../../harness/runner';
import type { ClamshellPoseIntent } from '../../harness/types';

const CAL_MS = 400;

describe('Clamshell — not-moving idle detection (init)', () => {
  it('fires not-moving exactly once after 5s of idle post-calibration', () => {
    // Calibrate quickly, then stay still for 5.5s
    const totalMs = CAL_MS + 5500;
    const frames = buildFrames(
      (tMs) => {
        return { abductionFrac: 0, sideDown: 'left' as const } as ClamshellPoseIntent;
      },
      buildClamshellPose,
      { fps: 30, durationMs: totalMs },
    );
    const result = runClamshellSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'not-moving')).toBe(1);
  });

  it('does not fire not-moving before 5s of idle', () => {
    // Only 4s post-calibration — not enough time for idle warning
    const totalMs = CAL_MS + 4000;
    const frames = buildFrames(
      () => ({ abductionFrac: 0, sideDown: 'left' as const } as ClamshellPoseIntent),
      buildClamshellPose,
      { fps: 30, durationMs: totalMs },
    );
    const result = runClamshellSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'not-moving')).toBe(0);
  });

  it('does not fire not-moving before calibration is confirmed', () => {
    // Stay still for 6s total but with null landmarks the whole time → never calibrates
    // Position-lost or nothing should fire, but NOT not-moving (requires calibration first)
    const frames = buildFrames(
      () => null,
      buildClamshellPose,
      { fps: 30, durationMs: 6000 },
    );
    const result = runClamshellSession(frames);
    expect(result.calibrationConfirmedAtMs).toBeNull();
    expect(countWarnings(result, 'not-moving')).toBe(0);
  });
});
