/**
 * Happy path: 5 clean curtsy lunges alternating sides.
 *
 * Each rep cycle (3500ms):
 *   0–1200 ms  : descend — front knee from ~170° → ~90°
 *   1200–1700  : hold at bottom (~90°)
 *   1700–2900  : ascend — front knee ~90° → ~170°
 *   2900–3500  : rest standing
 *
 * Calibration: stand still 2200ms (feet hip-width, arms at sides).
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildCurtsyLungePose } from '../../harness/pose-stub';
import { runCurtsyLungeSession, warningsOtherThan } from '../../harness/runner';
import type { CurtsyLungePoseIntent } from '../../harness/types';

const CAL_MS = 2200;
const REP_CYCLE_MS = 3500;

function happyPathIntent(reps: number) {
  const totalMs = CAL_MS + reps * REP_CYCLE_MS;
  return {
    totalMs,
    intentAt: (tMs: number): CurtsyLungePoseIntent => {
      if (tMs < CAL_MS) {
        return {
          kneeFlexionDeg: 170,
          crossoverRatio: 0,
        };
      }
      const repIndex = Math.floor((tMs - CAL_MS) / REP_CYCLE_MS);
      const tInRep = (tMs - CAL_MS) % REP_CYCLE_MS;
      // Alternate sides
      const crossoverRatio = 0.12; // valid curtsy crossover (>= 0.08 threshold)
      let kneeFlexionDeg: number;
      if (tInRep < 1200) {
        // descend 170° → 90°
        kneeFlexionDeg = 170 - (tInRep / 1200) * 80;
      } else if (tInRep < 1700) {
        // hold at bottom
        kneeFlexionDeg = 90;
      } else if (tInRep < 2900) {
        // ascend 90° → 170°
        kneeFlexionDeg = 90 + ((tInRep - 1700) / 1200) * 80;
      } else {
        // rest standing
        kneeFlexionDeg = 170;
      }
      return {
        kneeFlexionDeg,
        crossoverRatio: tInRep >= 2900 ? 0 : crossoverRatio,
      };
    },
  };
}

describe('Curtsy Lunge — happy path', () => {
  it('calibrates within 2.2s and counts 5 clean reps', () => {
    const { totalMs, intentAt } = happyPathIntent(5);
    const frames = buildFrames(intentAt, buildCurtsyLungePose, { fps: 30, durationMs: totalMs });

    const result = runCurtsyLungeSession(frames);

    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThanOrEqual(2300);
    expect(result.completedReps.length).toBe(5);
    expect(warningsOtherThan(result, 'not-moving').length).toBe(0);
  });

  it('each rep has peakDepthDeg ≤ 100°', () => {
    const { totalMs, intentAt } = happyPathIntent(5);
    const frames = buildFrames(intentAt, buildCurtsyLungePose, { fps: 30, durationMs: totalMs });

    const result = runCurtsyLungeSession(frames);

    expect(result.completedReps.length).toBe(5);
    for (const rep of result.completedReps) {
      expect(rep.peakDepthDeg).toBeLessThanOrEqual(100);
    }
  });

  it('counts 3 reps when given a 3-rep stream', () => {
    const { totalMs, intentAt } = happyPathIntent(3);
    const frames = buildFrames(intentAt, buildCurtsyLungePose, { fps: 30, durationMs: totalMs });
    const result = runCurtsyLungeSession(frames);
    expect(result.completedReps.length).toBe(3);
  });
});
