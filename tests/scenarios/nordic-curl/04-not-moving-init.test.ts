/**
 * Nordic Curl — not-moving idle detection init (Fix I + P)
 *
 * The idle tracker must initialize at cal-confirm, NOT at engine construction.
 * If it initializes at construction time, then at cal-confirm the idleMs =
 * now - 0 = huge number and 'not-moving' fires immediately.
 *
 * Tests:
 * - After calibration confirms, wait 5.5s without movement → expect 'not-moving' fires
 * - Before cal-confirm, no not-moving should fire even if landmarks are static for 6s
 */
import { describe, it, expect } from 'vitest';
import { buildFrames, concatFrames } from '../../harness/frame-stream';
import { buildNordicCurlPose } from '../../harness/pose-stub';
import { runNordicCurlSession, countWarnings } from '../../harness/runner';
import type { NordicCurlPoseIntent } from '../../harness/types';

const CAL_MS = 2500;
const NO_MOVEMENT_MS = 5000;

function calFrames() {
  return buildFrames(
    () => ({ trunkLeanDeg: 0, bodyHeight: 0.60 } as NordicCurlPoseIntent),
    buildNordicCurlPose as (i: NordicCurlPoseIntent) => import('@/modules/pose/types').PoseLandmarks,
    { fps: 30, durationMs: CAL_MS },
  );
}

describe('Nordic Curl — not-moving idle detection (Fix I + P)', () => {
  it('fires not-moving after 5.5s of idle post-calibration', () => {
    const idleFrames = buildFrames(
      () => ({ trunkLeanDeg: 0, bodyHeight: 0.60 } as NordicCurlPoseIntent),
      buildNordicCurlPose as (i: NordicCurlPoseIntent) => import('@/modules/pose/types').PoseLandmarks,
      { fps: 30, durationMs: NO_MOVEMENT_MS + 500 },
    );
    const frames = concatFrames(calFrames(), idleFrames);
    const result = runNordicCurlSession(frames);

    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'not-moving')).toBeGreaterThan(0);
  });

  it('does NOT fire not-moving in 3s of idle (total idle from cal-confirm < 5s)', () => {
    // Cal confirms at ~233ms. Total duration: 2500 + 3000 = 5500ms.
    // Idle from cal-confirm: 5500 - 233 = 5267ms — just over 5s.
    // Use 2s of idle only: total 4500ms. Idle from cal-confirm: 4500 - 233 = 4267ms < 5000ms.
    const shortIdleFrames = buildFrames(
      () => ({ trunkLeanDeg: 0, bodyHeight: 0.60 } as NordicCurlPoseIntent),
      buildNordicCurlPose as (i: NordicCurlPoseIntent) => import('@/modules/pose/types').PoseLandmarks,
      { fps: 30, durationMs: 2000 },
    );
    const frames = concatFrames(calFrames(), shortIdleFrames);
    const result = runNordicCurlSession(frames);

    expect(result.finalCalibration?.state).toBe('confirmed');
    // 2s of idle post-cal is less than 5s → should not fire
    expect(countWarnings(result, 'not-moving')).toBe(0);
  });

  it('does NOT fire not-moving during calibration phase even with static landmarks for 6s', () => {
    // 6 seconds of static calibration-failing poses (leaning at 35°)
    // Before cal-confirm, not-moving should never fire regardless of duration
    const frames = buildFrames(
      () => ({ trunkLeanDeg: 35, bodyHeight: 0.60 } as NordicCurlPoseIntent),
      buildNordicCurlPose as (i: NordicCurlPoseIntent) => import('@/modules/pose/types').PoseLandmarks,
      { fps: 30, durationMs: 6000 },
    );
    const result = runNordicCurlSession(frames);
    // Never confirmed, so not-moving should not fire
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(countWarnings(result, 'not-moving')).toBe(0);
  });
});
