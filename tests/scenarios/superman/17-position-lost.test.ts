/**
 * Regression tests for Superman Fix N — position-lost warning.
 *
 * Spec: if no usable pose frame (landmarks null OR core body landmarks not
 * visible) for ≥ 3 seconds post-calibration, the engine emits 'position-lost'.
 * Repeats at most every 10 s while the pose is still absent.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildSupermanPose } from '../../harness/pose-stub';
import { runSupermanSession, countWarnings } from '../../harness/runner';
import type { SupermanPoseIntent } from '../../harness/types';

const CAL_MS = 2200;

describe('Superman — position-lost warning (Fix N)', () => {
  it('fires position-lost after 3+ seconds of null landmarks post-calibration', () => {
    // Calibrate for 2.2 s (clean prone pose), then return null landmarks for 4 s.
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) {
          return {
            shoulderRise: 0,
            armsForward: true,
          } as SupermanPoseIntent;
        }
        // Post-cal: user stepped out of frame — no usable landmarks.
        return null;
      },
      buildSupermanPose,
      { fps: 30, durationMs: CAL_MS + 4000 },
    );

    const result = runSupermanSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'position-lost')).toBeGreaterThan(0);
  });

  it('does NOT fire position-lost on a clean continuous stream', () => {
    const frames = buildFrames(
      () =>
        ({
          shoulderRise: 0,
          armsForward: true,
        } as SupermanPoseIntent),
      buildSupermanPose,
      { fps: 30, durationMs: 5000 },
    );

    const result = runSupermanSession(frames);
    expect(countWarnings(result, 'position-lost')).toBe(0);
  });

  it('does NOT fire position-lost during the brief calibration phase', () => {
    // Null frames DURING calibration (user not yet lying down / in frame).
    // position-lost must not fire because calibration hasn't confirmed yet.
    const frames = buildFrames(
      (tMs) => {
        if (tMs < 1500) return null;
        // Come into frame at 1.5 s; calibration proceeds from here.
        return {
          shoulderRise: 0,
          armsForward: true,
        } as SupermanPoseIntent;
      },
      buildSupermanPose,
      { fps: 30, durationMs: 3500 },
    );

    const result = runSupermanSession(frames);
    expect(countWarnings(result, 'position-lost')).toBe(0);
  });

  it('does NOT re-fire position-lost within the 10 s cooldown', () => {
    // 5 seconds of null post-cal — should fire exactly once (at the 3 s mark).
    // The 10 s cooldown prevents a second fire within this window.
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) {
          return {
            shoulderRise: 0,
            armsForward: true,
          } as SupermanPoseIntent;
        }
        return null;
      },
      buildSupermanPose,
      { fps: 30, durationMs: CAL_MS + 5000 },
    );

    const result = runSupermanSession(frames);
    expect(countWarnings(result, 'position-lost')).toBe(1);
  });
});
