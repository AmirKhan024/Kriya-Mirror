/**
 * Burpee — position-lost warning (Fix N).
 *
 * Spec: if no usable pose frame (landmarks null OR core body landmarks
 * not visible) for >= 3 seconds post-calibration, the engine emits
 * 'position-lost'. Repeats at most every 10s while still lost.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildBurpeePose } from '../../harness/pose-stub';
import { runBurpeeSession, countWarnings } from '../../harness/runner';
import type { BurpeePoseIntent } from '../../harness/types';

const CAL_MS = 500;

describe('Burpee — position-lost warning (Fix N)', () => {
  it('fires position-lost after 3+ seconds of null landmarks post-calibration', () => {
    const frames = buildFrames(
      (tMs): BurpeePoseIntent | null => {
        if (tMs < CAL_MS) {
          return { hipYOffset: 0, kneeAngleDeg: 170, bodyHeight: 0.62 };
        }
        // Post-cal: user stepped out — no usable frame.
        return null;
      },
      buildBurpeePose as (intent: BurpeePoseIntent | null) => import('@/modules/pose/types').PoseLandmarks,
      { fps: 30, durationMs: CAL_MS + 4000 },
    );

    const result = runBurpeeSession(frames);

    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'position-lost')).toBeGreaterThan(0);
  });

  it('does NOT fire position-lost on a clean continuous stream', () => {
    const frames = buildFrames(
      (): BurpeePoseIntent => ({
        hipYOffset: 0,
        kneeAngleDeg: 170,
        bodyHeight: 0.62,
      }),
      buildBurpeePose,
      { fps: 30, durationMs: 4000 },
    );

    const result = runBurpeeSession(frames);

    expect(countWarnings(result, 'position-lost')).toBe(0);
  });

  it('does NOT fire position-lost during the calibration phase', () => {
    // Null frames during calibration (before confirmed) should not trigger position-lost.
    const frames = buildFrames(
      (tMs): BurpeePoseIntent | null => {
        if (tMs < 1000) return null;
        // Come into frame after 1s, calibrate
        return { hipYOffset: 0, kneeAngleDeg: 170, bodyHeight: 0.62 };
      },
      buildBurpeePose as (intent: BurpeePoseIntent | null) => import('@/modules/pose/types').PoseLandmarks,
      { fps: 30, durationMs: 3000 },
    );

    const result = runBurpeeSession(frames);

    expect(countWarnings(result, 'position-lost')).toBe(0);
  });

  it('does NOT re-fire position-lost within the 10s cooldown', () => {
    // 5 seconds of null post-cal — should fire exactly once (at the 3s mark).
    const frames = buildFrames(
      (tMs): BurpeePoseIntent | null => {
        if (tMs < CAL_MS) {
          return { hipYOffset: 0, kneeAngleDeg: 170, bodyHeight: 0.62 };
        }
        return null;
      },
      buildBurpeePose as (intent: BurpeePoseIntent | null) => import('@/modules/pose/types').PoseLandmarks,
      { fps: 30, durationMs: CAL_MS + 5000 },
    );

    const result = runBurpeeSession(frames);
    expect(countWarnings(result, 'position-lost')).toBe(1);
  });
});
