/**
 * Posture warnings:
 * - elbowSpreadRatio < 0.70 for 8+ frames during descent → goblet-elbows-collapsing fires
 * - elbows spread returns → warning stops (no spam when ratio recovers)
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildGobletSquatPose } from '../../harness/pose-stub';
import { runGobletSquatSession, countWarnings } from '../../harness/runner';
import type { GobletSquatPoseIntent } from '../../harness/types';

const CAL_MS = 2200;

function calIntent(): GobletSquatPoseIntent {
  return { kneeFlexionDeg: 0, feetWidthRatio: 1.25, elbowSpreadRatio: 1.0, bodyHeight: 0.70 };
}

describe('Goblet Squat — posture warnings', () => {
  it('fires goblet-elbows-collapsing when elbowSpreadRatio < 0.70 for 8+ frames during descent', () => {
    // Calibrate, then do a full squat rep with elbows collapsed (ratio=0.40) throughout descent
    const TOTAL_MS = CAL_MS + 5000;
    const REP_END_MS = CAL_MS + 3000;
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) return calIntent();
        if (tMs < REP_END_MS) {
          const tInRep = tMs - CAL_MS;
          let kneeFlexionDeg: number;
          // Full valid rep cycle
          if (tInRep < 1000) kneeFlexionDeg = (tInRep / 1000) * 100;
          else if (tInRep < 1500) kneeFlexionDeg = 100;
          else if (tInRep < 2500) kneeFlexionDeg = 100 - ((tInRep - 1500) / 1000) * 100;
          else kneeFlexionDeg = 0;
          // Elbows collapsed throughout the rep
          return { ...calIntent(), kneeFlexionDeg, elbowSpreadRatio: 0.40 };
        }
        return calIntent();
      },
      buildGobletSquatPose,
      { fps: 30, durationMs: TOTAL_MS },
    );

    const result = runGobletSquatSession(frames);

    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'goblet-elbows-collapsing' as any)).toBeGreaterThan(0);
  });

  it('does NOT fire goblet-elbows-collapsing when elbows are spread (ratio >= 0.70)', () => {
    const TOTAL_MS = CAL_MS + 5000;
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) return calIntent();
        const tInRep = tMs - CAL_MS;
        let kneeFlexionDeg: number;
        const repCycleMs = 3000;
        const t = tInRep % repCycleMs;
        if (t < 1000) kneeFlexionDeg = (t / 1000) * 100;
        else if (t < 1500) kneeFlexionDeg = 100;
        else if (t < 2500) kneeFlexionDeg = 100 - ((t - 1500) / 1000) * 100;
        else kneeFlexionDeg = 0;
        // Elbows properly spread
        return { ...calIntent(), kneeFlexionDeg, elbowSpreadRatio: 1.0 };
      },
      buildGobletSquatPose,
      { fps: 30, durationMs: TOTAL_MS },
    );

    const result = runGobletSquatSession(frames);

    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'goblet-elbows-collapsing' as any)).toBe(0);
  });

  it('does NOT fire goblet-elbows-collapsing if collapse lasts fewer than 8 frames', () => {
    // Only 4 frames of elbow collapse during descent (< ELBOW_DEBOUNCE_FRAMES=8)
    const CAL_END = CAL_MS;
    const TOTAL_MS = CAL_END + 5000;
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_END) return calIntent();
        const tInRep = tMs - CAL_END;
        let kneeFlexionDeg: number;
        const repCycleMs = 3000;
        const t = tInRep % repCycleMs;
        if (t < 1000) kneeFlexionDeg = (t / 1000) * 100;
        else if (t < 1500) kneeFlexionDeg = 100;
        else if (t < 2500) kneeFlexionDeg = 100 - ((t - 1500) / 1000) * 100;
        else kneeFlexionDeg = 0;
        // Brief collapse (4 frames at 30fps = ~133ms, < 8 frames threshold)
        const elbowSpreadRatio = (tInRep >= 200 && tInRep < 333) ? 0.40 : 1.0;
        return { ...calIntent(), kneeFlexionDeg, elbowSpreadRatio };
      },
      buildGobletSquatPose,
      { fps: 30, durationMs: TOTAL_MS },
    );

    const result = runGobletSquatSession(frames);

    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'goblet-elbows-collapsing' as any)).toBe(0);
  });
});
