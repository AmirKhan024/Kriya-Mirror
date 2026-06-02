/**
 * Regression test for round-6 `position-lost` warning on Pistol Squat.
 *
 * Spec: if no usable pose frame (landmarks null OR core body landmarks
 * not visible) for ≥ 3 seconds post-calibration, the engine emits
 * `position-lost`. Repeats at most every 10s while still lost.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildPistolSquatPose } from '../../harness/pose-stub';
import { runPistolSquatSession, countWarnings } from '../../harness/runner';
import type { PistolSquatPoseIntent } from '../../harness/types';

const CAL_MS = 2200;

describe('Pistol Squat — position-lost warning (Fix N)', () => {
  it('fires position-lost after 3+ seconds of null landmarks post-calibration', () => {
    // Calibrate for 2.2s (clean pose), then return null landmarks for 4s.
    const frames = buildFrames(
      (tMs): PistolSquatPoseIntent | null => {
        if (tMs < CAL_MS) {
          return { kneeFlexionDeg: 0, standingLeg: 'left', armsForward: false };
        }
        // Post-cal: user stepped out — no usable frame.
        return null;
      },
      buildPistolSquatPose,
      { fps: 30, durationMs: CAL_MS + 4000 },
    );

    const result = runPistolSquatSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'position-lost')).toBeGreaterThan(0);
  });

  it('does NOT fire position-lost on a clean continuous stream', () => {
    const frames = buildFrames(
      (): PistolSquatPoseIntent => ({
        kneeFlexionDeg: 0,
        standingLeg: 'left',
        armsForward: false,
      }),
      buildPistolSquatPose,
      { fps: 30, durationMs: 4000 },
    );

    const result = runPistolSquatSession(frames);
    expect(countWarnings(result, 'position-lost')).toBe(0);
  });

  it('does NOT fire position-lost during the calibration phase', () => {
    // If frames are null DURING calibration (user not yet in frame), the
    // position-lost check shouldn't fire because the engine isn't yet
    // confirmed.
    const frames = buildFrames(
      (tMs): PistolSquatPoseIntent | null => {
        if (tMs < 1500) return null;
        // Then come into frame; calibrate from t=1500 onwards.
        return { kneeFlexionDeg: 0, standingLeg: 'left', armsForward: false };
      },
      buildPistolSquatPose,
      { fps: 30, durationMs: 3000 },
    );

    const result = runPistolSquatSession(frames);
    expect(countWarnings(result, 'position-lost')).toBe(0);
  });

  it('does NOT re-fire position-lost within the 10s cooldown', () => {
    // 5 seconds of null post-cal — should fire exactly once (at the 3s mark).
    const frames = buildFrames(
      (tMs): PistolSquatPoseIntent | null => {
        if (tMs < CAL_MS) {
          return { kneeFlexionDeg: 0, standingLeg: 'left', armsForward: false };
        }
        return null;
      },
      buildPistolSquatPose,
      { fps: 30, durationMs: CAL_MS + 5000 },
    );

    const result = runPistolSquatSession(frames);
    expect(countWarnings(result, 'position-lost')).toBe(1);
  });
});
