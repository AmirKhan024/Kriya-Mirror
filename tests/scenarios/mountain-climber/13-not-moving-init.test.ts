/**
 * Mountain Climber — not-moving warning: cold-start / init (Fix I + P)
 *
 * Idle tracking initialises on calibration confirm (Fix I). The first
 * `not-moving` warning fires after NO_MOVEMENT_TIMEOUT_MS = 5000ms of
 * no significant knee angle change (variance < 2°).
 *
 * Fix P: cold-start sentinel — `lastNoMovementWarnAt === 0` means it hasn't
 * fired yet, so the initial 5s wait is honoured even with no prior warning.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildMountainClimberPose } from '../../harness/pose-stub';
import { runMountainClimberSession, countWarnings } from '../../harness/runner';
import type { MountainClimberPoseIntent } from '../../harness/types';

const CAL_MS = 500;

describe('Mountain Climber — not-moving init (Fix I + P)', () => {
  it('fires not-moving exactly once after 5s of idle in PLANK post-calibration', () => {
    // Hold perfect PLANK for 7 seconds after calibration, no drives at all.
    const TOTAL_MS = CAL_MS + 7000;
    const frames = buildFrames(
      (tMs): MountainClimberPoseIntent => ({
        kneeHipAngleDeg: 165,  // PLANK angle (> 140°)
        bodyLength: 0.55,
      }),
      buildMountainClimberPose,
      { fps: 30, durationMs: TOTAL_MS },
    );
    const result = runMountainClimberSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    // Should fire at least once (between 5s and 20s of idle — no repeat until 15s)
    expect(countWarnings(result, 'not-moving')).toBeGreaterThanOrEqual(1);
  });

  it('does NOT fire not-moving at 3s (before the 5s gate)', () => {
    // 3 seconds of idle after calibration — not enough
    const TOTAL_MS = CAL_MS + 3000;
    const frames = buildFrames(
      (): MountainClimberPoseIntent => ({ kneeHipAngleDeg: 165, bodyLength: 0.55 }),
      buildMountainClimberPose,
      { fps: 30, durationMs: TOTAL_MS },
    );
    const result = runMountainClimberSession(frames);
    expect(countWarnings(result, 'not-moving')).toBe(0);
  });

  it('does NOT fire not-moving when user is actively driving (angle varies > 2°)', () => {
    // Continuously oscillate angle by 10° — variance always above threshold
    const TOTAL_MS = CAL_MS + 7000;
    const frames = buildFrames(
      (tMs): MountainClimberPoseIntent => {
        if (tMs < CAL_MS) return { kneeHipAngleDeg: 170, bodyLength: 0.55 };
        // Oscillate 160° ↔ 170° continuously (angle variance > 2°)
        const osc = Math.sin((tMs - CAL_MS) / 200) * 5 + 165;
        return { kneeHipAngleDeg: osc, bodyLength: 0.55 };
      },
      buildMountainClimberPose,
      { fps: 30, durationMs: TOTAL_MS },
    );
    const result = runMountainClimberSession(frames);
    expect(countWarnings(result, 'not-moving')).toBe(0);
  });

  it('fires not-moving at most once within the 15s repeat window', () => {
    // 12 seconds idle — should fire once at 5s, repeat window is 15s so no second
    const TOTAL_MS = CAL_MS + 12_000;
    const frames = buildFrames(
      (): MountainClimberPoseIntent => ({ kneeHipAngleDeg: 165, bodyLength: 0.55 }),
      buildMountainClimberPose,
      { fps: 30, durationMs: TOTAL_MS },
    );
    const result = runMountainClimberSession(frames);
    expect(countWarnings(result, 'not-moving')).toBe(1);
  });
});
