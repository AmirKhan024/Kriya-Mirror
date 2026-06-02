/**
 * Burpee — warning gating during STANDING.
 * Fix A: hip-sag must NOT fire when repState === 'STANDING'.
 *
 * This test injects a large hipPlankDeviation value while the user is
 * standing upright (STANDING state, no rep in progress). The engine
 * must NOT emit hip-sag in this state.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildBurpeePose } from '../../harness/pose-stub';
import { runBurpeeSession, countWarnings } from '../../harness/runner';
import type { BurpeePoseIntent } from '../../harness/types';

const CAL_MS = 500;

describe('Burpee — warning gating during STANDING (Fix A)', () => {
  it('does NOT emit hip-sag when user is standing still (not in a rep)', () => {
    // User stands still after calibration with a hipPlankDeviation injected.
    // Since repState === STANDING (never entered a rep), hip-sag must not fire.
    const totalMs = CAL_MS + 3000;

    const frames = buildFrames(
      (tMs): BurpeePoseIntent => {
        if (tMs < CAL_MS) {
          return { hipYOffset: 0, kneeAngleDeg: 170, bodyHeight: 0.62 };
        }
        // Standing with large plank deviation injected — but repState=STANDING
        return {
          hipYOffset: 0,          // at baseline — STANDING state
          kneeAngleDeg: 170,
          hipPlankDeviation: 0.10, // would trigger hip-sag IF in active rep
          bodyHeight: 0.62,
        };
      },
      buildBurpeePose,
      { fps: 30, durationMs: totalMs },
    );

    const result = runBurpeeSession(frames);

    expect(result.finalCalibration?.state).toBe('confirmed');
    // hip-sag must NOT fire during STANDING phase
    expect(countWarnings(result, 'hip-sag')).toBe(0);
  });

  it('also does not emit hip-sag during SQUATTING (only PLANK phase)', () => {
    // User enters SQUATTING (hipYOffset > 0.04) but never reaches PLANK.
    // hipPlankDeviation is set — still should not fire hip-sag.
    const totalMs = CAL_MS + 2000;

    const frames = buildFrames(
      (tMs): BurpeePoseIntent => {
        if (tMs < CAL_MS) {
          return { hipYOffset: 0, kneeAngleDeg: 170, bodyHeight: 0.62 };
        }
        const t = tMs - CAL_MS;
        if (t < 800) {
          // Squat — between SQUAT_ENTER (0.04) and PLANK_ENTER (0.14)
          return {
            hipYOffset: 0.08,
            kneeAngleDeg: 100,
            hipPlankDeviation: 0.10,
            bodyHeight: 0.62,
          };
        }
        return { hipYOffset: 0, kneeAngleDeg: 170, bodyHeight: 0.62 };
      },
      buildBurpeePose,
      { fps: 30, durationMs: totalMs },
    );

    const result = runBurpeeSession(frames);

    expect(result.finalCalibration?.state).toBe('confirmed');
    // No hip-sag since user never reached PLANK state
    expect(countWarnings(result, 'hip-sag')).toBe(0);
  });
});
