/**
 * Fix A: Warning gating — elbow-collapse check must NOT fire when repState === 'STANDING'.
 *
 * Test: user stands still with elbows completely collapsed (ratio=0.20) between reps.
 * Expect: no 'goblet-elbows-collapsing' warning fires during rest.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildGobletSquatPose } from '../../harness/pose-stub';
import { runGobletSquatSession, countWarnings } from '../../harness/runner';
import type { GobletSquatPoseIntent } from '../../harness/types';

const CAL_MS = 2200;

describe('Goblet Squat — warning gating (Fix A)', () => {
  it('does NOT fire goblet-elbows-collapsing when user is STANDING (not in active rep)', () => {
    // After calibration, user stands still with collapsed elbows (ratio=0.20).
    // No squat is performed, so repState stays STANDING throughout.
    // The elbow-collapse check is gated to inActiveRep, so it must NOT fire.
    const TOTAL_MS = CAL_MS + 8000;
    const frames = buildFrames(
      (tMs): GobletSquatPoseIntent => {
        if (tMs < CAL_MS) {
          // Calibration: proper elbows spread
          return { kneeFlexionDeg: 0, feetWidthRatio: 1.25, elbowSpreadRatio: 1.0, bodyHeight: 0.70 };
        }
        // Post-calibration: standing still with elbows collapsed
        return { kneeFlexionDeg: 0, feetWidthRatio: 1.25, elbowSpreadRatio: 0.20, bodyHeight: 0.70 };
      },
      buildGobletSquatPose,
      { fps: 30, durationMs: TOTAL_MS },
    );

    const result = runGobletSquatSession(frames);

    expect(result.finalCalibration?.state).toBe('confirmed');
    // No rep performed — repState was STANDING throughout
    expect(result.completedReps.length).toBe(0);
    // Elbow collapse warning must NOT fire (Fix A gating)
    expect(countWarnings(result, 'goblet-elbows-collapsing' as any)).toBe(0);
  });

  it('fires goblet-elbows-collapsing when elbows collapse DURING an active rep', () => {
    // Do a full rep with collapsed elbows — warning should fire
    const REP_CYCLE_MS = 3000;
    const TOTAL_MS = CAL_MS + REP_CYCLE_MS + 1000;
    const frames = buildFrames(
      (tMs): GobletSquatPoseIntent => {
        if (tMs < CAL_MS) {
          return { kneeFlexionDeg: 0, feetWidthRatio: 1.25, elbowSpreadRatio: 1.0, bodyHeight: 0.70 };
        }
        const tInRep = tMs - CAL_MS;
        let kneeFlexionDeg: number;
        if (tInRep < 1000) kneeFlexionDeg = (tInRep / 1000) * 100;
        else if (tInRep < 1500) kneeFlexionDeg = 100;
        else if (tInRep < 2500) kneeFlexionDeg = 100 - ((tInRep - 1500) / 1000) * 100;
        else kneeFlexionDeg = 0;
        return { kneeFlexionDeg, feetWidthRatio: 1.25, elbowSpreadRatio: 0.40, bodyHeight: 0.70 };
      },
      buildGobletSquatPose,
      { fps: 30, durationMs: TOTAL_MS },
    );

    const result = runGobletSquatSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'goblet-elbows-collapsing' as any)).toBeGreaterThan(0);
  });
});
