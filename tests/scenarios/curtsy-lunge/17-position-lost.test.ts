/**
 * Regression test for Fix N: position-lost warning on Curtsy Lunge.
 *
 * Spec: if no usable pose frame (landmarks null OR core body landmarks
 * not visible) for ≥ 3 seconds post-calibration, the engine emits
 * `position-lost`. Repeats at most every 10s while still lost.
 *
 * Mirrors tests/scenarios/lunge/17-position-lost.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildCurtsyLungePose } from '../../harness/pose-stub';
import { runCurtsyLungeSession, countWarnings } from '../../harness/runner';
import type { CurtsyLungePoseIntent } from '../../harness/types';

const CAL_MS = 2200;

describe('Curtsy Lunge — position-lost warning (Fix N)', () => {
  it('fires position-lost after 3+ seconds of null landmarks post-calibration', () => {
    // Calibrate for 2.2s (clean pose), then return null landmarks for 4s.
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) {
          return {
            kneeFlexionDeg: 170,
            crossoverRatio: 0,
          } as CurtsyLungePoseIntent;
        }
        // Post-cal: user stepped out — no usable frame
        return null;
      },
      buildCurtsyLungePose,
      { fps: 30, durationMs: CAL_MS + 4000 },
    );

    const result = runCurtsyLungeSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'position-lost')).toBeGreaterThan(0);
  });

  it('does NOT fire position-lost on a clean continuous stream', () => {
    const frames = buildFrames(
      () => ({
        kneeFlexionDeg: 170,
        crossoverRatio: 0,
      } as CurtsyLungePoseIntent),
      buildCurtsyLungePose,
      { fps: 30, durationMs: 4000 },
    );

    const result = runCurtsyLungeSession(frames);
    expect(countWarnings(result, 'position-lost')).toBe(0);
  });

  it('does NOT fire position-lost during the calibration phase', () => {
    // Null frames during calibration (user not yet in frame) — should not fire
    // because calibration hasn't confirmed yet.
    const frames = buildFrames(
      (tMs) => {
        if (tMs < 1500) return null;
        return {
          kneeFlexionDeg: 170,
          crossoverRatio: 0,
        } as CurtsyLungePoseIntent;
      },
      buildCurtsyLungePose,
      { fps: 30, durationMs: 3000 },
    );

    const result = runCurtsyLungeSession(frames);
    expect(countWarnings(result, 'position-lost')).toBe(0);
  });

  it('does NOT re-fire position-lost within the 10s cooldown', () => {
    // 5 seconds of null post-cal → should fire exactly once (at the 3s mark).
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) {
          return {
            kneeFlexionDeg: 170,
            crossoverRatio: 0,
          } as CurtsyLungePoseIntent;
        }
        return null;
      },
      buildCurtsyLungePose,
      { fps: 30, durationMs: CAL_MS + 5000 },
    );

    const result = runCurtsyLungeSession(frames);
    expect(countWarnings(result, 'position-lost')).toBe(1);
  });
});
