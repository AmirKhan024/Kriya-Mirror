/**
 * Burpee — posture warnings.
 * Verifies that hip-sag fires during PLANK phase when hip deviates below
 * the shoulder-to-ankle midline. Also verifies it fires during active rep.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildBurpeePose } from '../../harness/pose-stub';
import { runBurpeeSession, countWarnings } from '../../harness/runner';
import type { BurpeePoseIntent } from '../../harness/types';

const CAL_MS = 500;

function calibrationIntent(): BurpeePoseIntent {
  return { hipYOffset: 0, kneeAngleDeg: 170, bodyHeight: 0.62 };
}

describe('Burpee — posture warnings', () => {
  it('fires hip-sag during PLANK phase when hip drops below line', () => {
    // User: calibrate → squat → plank (with hip sag deviation > 0.04) → rise → jump → land
    const totalMs = CAL_MS + 3000;

    const frames = buildFrames(
      (tMs): BurpeePoseIntent => {
        if (tMs < CAL_MS) return calibrationIntent();
        const t = tMs - CAL_MS;

        if (t < 300) {
          // Squat down
          const frac = t / 300;
          return { hipYOffset: frac * 0.05, kneeAngleDeg: 170 - frac * 80, bodyHeight: 0.62 };
        } else if (t < 600) {
          // To plank
          const frac = (t - 300) / 300;
          return { hipYOffset: 0.05 + frac * 0.12, kneeAngleDeg: 90 + frac * 80, bodyHeight: 0.62 };
        } else if (t < 1200) {
          // Plank with hip SAG (hipPlankDeviation > HIP_SAG_THRESHOLD = 0.04)
          return { hipYOffset: 0.17, kneeAngleDeg: 170, hipPlankDeviation: 0.06, bodyHeight: 0.62 };
        } else if (t < 1500) {
          // Rising
          const frac = (t - 1200) / 300;
          return { hipYOffset: 0.17 - frac * 0.15, kneeAngleDeg: 170, bodyHeight: 0.62 };
        } else if (t < 1800) {
          // Jump
          const frac = (t - 1500) / 300;
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
    // hip-sag should fire during plank
    expect(countWarnings(result, 'hip-sag')).toBeGreaterThan(0);
  });

  it('does NOT fire hip-sag when plank form is correct (no deviation)', () => {
    const totalMs = CAL_MS + 3000;

    const frames = buildFrames(
      (tMs): BurpeePoseIntent => {
        if (tMs < CAL_MS) return calibrationIntent();
        const t = tMs - CAL_MS;

        if (t < 300) {
          const frac = t / 300;
          return { hipYOffset: frac * 0.05, kneeAngleDeg: 170 - frac * 80, bodyHeight: 0.62 };
        } else if (t < 600) {
          const frac = (t - 300) / 300;
          return { hipYOffset: 0.05 + frac * 0.12, kneeAngleDeg: 90 + frac * 80, bodyHeight: 0.62 };
        } else if (t < 1200) {
          // Good plank — no hip deviation
          return { hipYOffset: 0.17, kneeAngleDeg: 170, hipPlankDeviation: 0, bodyHeight: 0.62 };
        } else if (t < 1500) {
          const frac = (t - 1200) / 300;
          return { hipYOffset: 0.17 - frac * 0.15, kneeAngleDeg: 170, bodyHeight: 0.62 };
        } else if (t < 1800) {
          const frac = (t - 1500) / 300;
          return { hipYOffset: -0.06 * Math.sin(frac * Math.PI), kneeAngleDeg: 170, bodyHeight: 0.62 };
        } else {
          return { hipYOffset: 0, kneeAngleDeg: 170, bodyHeight: 0.62 };
        }
      },
      buildBurpeePose,
      { fps: 30, durationMs: totalMs },
    );

    const result = runBurpeeSession(frames);
    expect(countWarnings(result, 'hip-sag')).toBe(0);
  });
});
