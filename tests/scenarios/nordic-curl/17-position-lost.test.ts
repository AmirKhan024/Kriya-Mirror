/**
 * Regression test for position-lost warning on Nordic Curl.
 *
 * Spec: if no usable pose frame (landmarks null OR core body landmarks
 * not visible) for ≥ 3 seconds post-calibration, the engine emits
 * `position-lost`. Repeats at most every 10s while still lost.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildNordicCurlPose } from '../../harness/pose-stub';
import { runNordicCurlSession, countWarnings } from '../../harness/runner';
import type { NordicCurlPoseIntent } from '../../harness/types';

const CAL_MS = 2500;

describe('Nordic Curl — position-lost warning', () => {
  it('fires position-lost after 3+ seconds of null landmarks post-calibration', () => {
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) {
          return { trunkLeanDeg: 0, bodyHeight: 0.60 } as NordicCurlPoseIntent;
        }
        // Post-cal: user stepped out — no usable frame.
        return null;
      },
      buildNordicCurlPose as (i: NordicCurlPoseIntent) => import('@/modules/pose/types').PoseLandmarks,
      { fps: 30, durationMs: CAL_MS + 4000 },
    );

    const result = runNordicCurlSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'position-lost')).toBeGreaterThan(0);
  });

  it('does NOT fire position-lost on a clean continuous stream', () => {
    const frames = buildFrames(
      () => ({ trunkLeanDeg: 0, bodyHeight: 0.60 } as NordicCurlPoseIntent),
      buildNordicCurlPose as (i: NordicCurlPoseIntent) => import('@/modules/pose/types').PoseLandmarks,
      { fps: 30, durationMs: 4000 },
    );

    const result = runNordicCurlSession(frames);
    expect(countWarnings(result, 'position-lost')).toBe(0);
  });

  it('does NOT fire position-lost during the calibration phase', () => {
    // Null frames DURING calibration — the engine hasn't confirmed yet, so
    // position-lost should not fire.
    const frames = buildFrames(
      (tMs) => {
        if (tMs < 1500) return null;
        // Come into frame at 1.5s, calibrate from there
        return { trunkLeanDeg: 0, bodyHeight: 0.60 } as NordicCurlPoseIntent;
      },
      buildNordicCurlPose as (i: NordicCurlPoseIntent) => import('@/modules/pose/types').PoseLandmarks,
      { fps: 30, durationMs: 3500 },
    );

    const result = runNordicCurlSession(frames);
    expect(countWarnings(result, 'position-lost')).toBe(0);
  });

  it('does NOT re-fire position-lost within the 10s cooldown', () => {
    // 5s of null post-cal → should fire exactly once (at the 3s mark).
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) {
          return { trunkLeanDeg: 0, bodyHeight: 0.60 } as NordicCurlPoseIntent;
        }
        return null;
      },
      buildNordicCurlPose as (i: NordicCurlPoseIntent) => import('@/modules/pose/types').PoseLandmarks,
      { fps: 30, durationMs: CAL_MS + 5000 },
    );

    const result = runNordicCurlSession(frames);
    expect(countWarnings(result, 'position-lost')).toBe(1);
  });
});
