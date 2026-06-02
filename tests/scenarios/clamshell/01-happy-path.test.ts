/**
 * Clamshell — happy path.
 *
 * Scenario: 2.2s calibration (lying on side, left side down), then 5 reps.
 * Each rep: abductionFrac 0 → 0.45 over 1000ms, hold 400ms, return over 1000ms, rest 600ms.
 *
 * Assert:
 *   - calibrationConfirmedAtMs ≤ 2300
 *   - completedReps.length === 5
 *   - avgMqs ≥ 55
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildClamshellPose } from '../../harness/pose-stub';
import { runClamshellSession, warningsOtherThan } from '../../harness/runner';
import type { ClamshellPoseIntent } from '../../harness/types';

const CAL_MS = 2200;
const REP_CYCLE_MS = 3000;

function happyPathFrames(reps: number) {
  const totalMs = CAL_MS + reps * REP_CYCLE_MS + 500;
  return buildFrames(
    (tMs) => {
      if (tMs < CAL_MS) {
        // Calibration: lying on side, left side down, knees together
        return { abductionFrac: 0, sideDown: 'left' as const } as ClamshellPoseIntent;
      }
      const tInRep = (tMs - CAL_MS) % REP_CYCLE_MS;
      let frac: number;
      if (tInRep < 1000) frac = (tInRep / 1000) * 0.45;       // opening
      else if (tInRep < 1400) frac = 0.45;                       // hold at top
      else if (tInRep < 2400) frac = 0.45 - ((tInRep - 1400) / 1000) * 0.45; // closing
      else frac = 0;                                              // rest
      return { abductionFrac: frac, sideDown: 'left' as const } as ClamshellPoseIntent;
    },
    buildClamshellPose,
    { fps: 30, durationMs: totalMs },
  );
}

describe('Clamshell — happy path', () => {
  it('calibrates within 2.3s and counts 5 clean reps', () => {
    const frames = happyPathFrames(5);
    const result = runClamshellSession(frames);

    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThanOrEqual(2300);
    expect(result.completedReps.length).toBe(5);
    expect(warningsOtherThan(result, 'not-moving').length).toBe(0);

    const avgMqs = result.completedReps.reduce((s, r) => s + r.mqs, 0) / result.completedReps.length;
    expect(avgMqs).toBeGreaterThanOrEqual(55);
  });

  it('counts 3 reps when given a 3-rep stream', () => {
    const frames = happyPathFrames(3);
    const result = runClamshellSession(frames);
    expect(result.completedReps.length).toBe(3);
  });

  it('peakOpenFrac is recorded correctly on each rep', () => {
    const frames = happyPathFrames(2);
    const result = runClamshellSession(frames);
    expect(result.completedReps.length).toBe(2);
    // Each rep opens to ~0.45 — peakOpenFrac should be positive
    for (const rep of result.completedReps) {
      expect(rep.peakOpenFrac).toBeGreaterThan(0.10);
    }
  });
});
