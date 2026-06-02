/**
 * Fix N regression: position-lost warning fires after 3s of null/occluded
 * landmarks post-calibration, and repeats at most every 10s.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildHammerCurlPose } from '../../harness/pose-stub';
import { runHammerCurlSession, countWarnings } from '../../harness/runner';
import type { HammerCurlPoseIntent } from '../../harness/types';

const CAL_MS = 2200;

describe('Hammer Curl — position-lost warning', () => {
  it('fires position-lost after 3+ seconds of null landmarks post-calibration', () => {
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) return { elbowFlexionDeg: 0 } as HammerCurlPoseIntent;
        return null;
      },
      buildHammerCurlPose,
      { fps: 30, durationMs: CAL_MS + 4000 },
    );

    const result = runHammerCurlSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'position-lost')).toBeGreaterThan(0);
  });

  it('does NOT fire position-lost on a clean continuous stream', () => {
    const frames = buildFrames(
      () => ({ elbowFlexionDeg: 0 } as HammerCurlPoseIntent),
      buildHammerCurlPose,
      { fps: 30, durationMs: 4000 },
    );

    const result = runHammerCurlSession(frames);
    expect(countWarnings(result, 'position-lost')).toBe(0);
  });

  it('does NOT fire position-lost during the brief calibration phase', () => {
    const frames = buildFrames(
      (tMs) => {
        if (tMs < 1500) return null;
        return { elbowFlexionDeg: 0 } as HammerCurlPoseIntent;
      },
      buildHammerCurlPose,
      { fps: 30, durationMs: 3000 },
    );

    const result = runHammerCurlSession(frames);
    expect(countWarnings(result, 'position-lost')).toBe(0);
  });

  it('does NOT re-fire position-lost within the 10s cooldown', () => {
    // 5s null post-cal — should fire exactly once (at the 3s mark).
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) return { elbowFlexionDeg: 0 } as HammerCurlPoseIntent;
        return null;
      },
      buildHammerCurlPose,
      { fps: 30, durationMs: CAL_MS + 5000 },
    );

    const result = runHammerCurlSession(frames);
    expect(countWarnings(result, 'position-lost')).toBe(1);
  });
});
