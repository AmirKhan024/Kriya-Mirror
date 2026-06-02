/**
 * Mountain Climber — position-lost warning (Fix N)
 *
 * Mirror of lunge/17-position-lost.test.ts.
 *
 * If no usable pose landmarks for ≥ 3 seconds post-calibration, the engine
 * emits `position-lost`. Repeats at most every 10s while still lost.
 * Does NOT fire during calibration phase.
 * Does NOT fire within the 3s window (only after).
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildMountainClimberPose } from '../../harness/pose-stub';
import { runMountainClimberSession, countWarnings } from '../../harness/runner';
import type { MountainClimberPoseIntent } from '../../harness/types';

const CAL_MS = 500;

describe('Mountain Climber — position-lost warning (Fix N)', () => {
  it('fires position-lost after 3+ seconds of null landmarks post-calibration', () => {
    // Calibrate for 500ms, then return null for 4s
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) {
          return { kneeHipAngleDeg: 170, bodyLength: 0.55 } as MountainClimberPoseIntent;
        }
        // User stepped out of frame
        return null;
      },
      buildMountainClimberPose,
      { fps: 30, durationMs: CAL_MS + 4000 },
    );
    const result = runMountainClimberSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'position-lost')).toBeGreaterThan(0);
  });

  it('does NOT fire position-lost on a clean continuous stream', () => {
    // Continuous good frames — no position loss
    const frames = buildFrames(
      (): MountainClimberPoseIntent => ({ kneeHipAngleDeg: 165, bodyLength: 0.55 }),
      buildMountainClimberPose,
      { fps: 30, durationMs: 5000 },
    );
    const result = runMountainClimberSession(frames);
    expect(countWarnings(result, 'position-lost')).toBe(0);
  });

  it('does NOT fire position-lost during the brief calibration phase', () => {
    // Null frames DURING calibration then come into frame
    const frames = buildFrames(
      (tMs) => {
        if (tMs < 1000) return null;
        return { kneeHipAngleDeg: 170, bodyLength: 0.55 } as MountainClimberPoseIntent;
      },
      buildMountainClimberPose,
      { fps: 30, durationMs: 3000 },
    );
    const result = runMountainClimberSession(frames);
    // Engine is not confirmed during the null phase — position-lost check doesn't apply
    expect(countWarnings(result, 'position-lost')).toBe(0);
  });

  it('does NOT re-fire position-lost within the 10s cooldown', () => {
    // 5 seconds of null post-cal — fires exactly once (at the 3s mark)
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) {
          return { kneeHipAngleDeg: 170, bodyLength: 0.55 } as MountainClimberPoseIntent;
        }
        return null;
      },
      buildMountainClimberPose,
      { fps: 30, durationMs: CAL_MS + 5000 },
    );
    const result = runMountainClimberSession(frames);
    expect(countWarnings(result, 'position-lost')).toBe(1);
  });

  it('re-fires position-lost after the 10s cooldown (fires twice in 15s lost)', () => {
    // 14 seconds of null post-cal — should fire at ~3s and ~13s
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) {
          return { kneeHipAngleDeg: 170, bodyLength: 0.55 } as MountainClimberPoseIntent;
        }
        return null;
      },
      buildMountainClimberPose,
      { fps: 30, durationMs: CAL_MS + 14_000 },
    );
    const result = runMountainClimberSession(frames);
    expect(countWarnings(result, 'position-lost')).toBe(2);
  });
});
