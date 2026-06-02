/**
 * Burpee — not-moving fires after 5s of idle standing (Fix I + Fix P).
 *
 * The idle tracking is seeded on calibration confirmation.
 * Standing still for 5+ seconds without any rep → 'not-moving' warning.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildBurpeePose } from '../../harness/pose-stub';
import { runBurpeeSession, countWarnings } from '../../harness/runner';
import type { BurpeePoseIntent } from '../../harness/types';

const CAL_MS = 500;

describe('Burpee — not-moving (idle) warning (Fix I + Fix P)', () => {
  it('fires not-moving after 5+ seconds of standing still post-calibration', () => {
    // Calibrate (500ms) + stand still for 7 seconds = 7.5s total.
    // No movement → not-moving should fire at ~5s idle mark.
    const IDLE_MS = 7000;
    const totalMs = CAL_MS + IDLE_MS;

    const frames = buildFrames(
      (tMs): BurpeePoseIntent => {
        if (tMs < CAL_MS) return { hipYOffset: 0, kneeAngleDeg: 170, bodyHeight: 0.62 };
        // Standing still — no movement
        return { hipYOffset: 0, kneeAngleDeg: 170, bodyHeight: 0.62 };
      },
      buildBurpeePose,
      { fps: 30, durationMs: totalMs },
    );

    const result = runBurpeeSession(frames);

    expect(result.finalCalibration?.state).toBe('confirmed');
    // not-moving must fire at least once
    expect(countWarnings(result, 'not-moving')).toBeGreaterThanOrEqual(1);
  });

  it('does NOT fire not-moving during active burpee reps', () => {
    // One full burpee (2s) — should NOT trigger not-moving during the rep.
    const REP_MS = 2000;
    const totalMs = CAL_MS + REP_MS;

    const frames = buildFrames(
      (tMs): BurpeePoseIntent => {
        if (tMs < CAL_MS) return { hipYOffset: 0, kneeAngleDeg: 170, bodyHeight: 0.62 };
        const t = tMs - CAL_MS;
        if (t < 300) {
          const frac = t / 300;
          return { hipYOffset: frac * 0.05, kneeAngleDeg: 170 - frac * 80, bodyHeight: 0.62 };
        } else if (t < 600) {
          const frac = (t - 300) / 300;
          return { hipYOffset: 0.05 + frac * 0.12, kneeAngleDeg: 90 + frac * 80, bodyHeight: 0.62 };
        } else if (t < 900) {
          return { hipYOffset: 0.17, kneeAngleDeg: 170, bodyHeight: 0.62 };
        } else if (t < 1200) {
          const frac = (t - 900) / 300;
          return { hipYOffset: 0.17 - frac * 0.15, kneeAngleDeg: 170, bodyHeight: 0.62 };
        } else if (t < 1500) {
          const frac = (t - 1200) / 300;
          return { hipYOffset: -0.06 * Math.sin(frac * Math.PI), kneeAngleDeg: 170, bodyHeight: 0.62 };
        } else {
          return { hipYOffset: 0, kneeAngleDeg: 170, bodyHeight: 0.62 };
        }
      },
      buildBurpeePose,
      { fps: 30, durationMs: totalMs },
    );

    const result = runBurpeeSession(frames);

    expect(result.finalCalibration?.state).toBe('confirmed');
    // The 2s rep + 500ms idle after should not trigger not-moving (need 5s idle)
    expect(countWarnings(result, 'not-moving')).toBe(0);
  });
});
