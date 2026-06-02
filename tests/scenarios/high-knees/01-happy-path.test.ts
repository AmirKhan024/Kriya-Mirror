import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildHighKneesPose } from '../../harness/pose-stub';
import { runHighKneesSession, warningsOtherThan } from '../../harness/runner';

// 2.2 s calibration in BOTH_DOWN, then alternating L/R knee lifts.
// 2026-05-28 round 23: peak intent raised 50 → 70 % to provide clear margin
// above the new MIN_REP_HEIGHT_PCT=50 threshold. Cycle lengthened 1000 → 1400
// ms so the EMA-smoothed signal has time to drop below LOW_THRESHOLD=15 on
// the descending side before the rising side takes over (higher peak ⇒ slower
// EMA decay in absolute terms). Real high-knees cadence at ~150 steps/min is
// ~400 ms per step, but the smoothing dynamics require this synthetic
// margin in tests.
//
// Cycle plan (1400 ms):
//   0–350 ms     : LEFT knee rises 0 → 70 %
//   350–700      : LEFT holds at 70 %
//   700–1050     : LEFT falls to 0, RIGHT rises to 70 %
//   1050–1300    : RIGHT holds at 70 %
//   1300–1400    : RIGHT falls to 0 (ready for next cycle)
//
// One cycle produces 2 reps (one L, one R). For 10 reps → 5 cycles = 7 s.
function happyPathIntent(reps: number) {
  const calMs = 2200;
  const cyclesNeeded = Math.ceil(reps / 2);
  const cycleMs = 1400;
  const totalMs = calMs + cyclesNeeded * cycleMs + 800;
  return {
    totalMs,
    intentAt: (tMs: number) => {
      if (tMs < calMs) return { leftKneeLiftPct: 0, rightKneeLiftPct: 0 };
      const tInCycle = (tMs - calMs) % cycleMs;
      let left: number, right: number;
      if (tInCycle < 350) { left = (tInCycle / 350) * 70; right = 0; }
      else if (tInCycle < 700) { left = 70; right = 0; }
      else if (tInCycle < 1050) {
        const u = (tInCycle - 700) / 350;
        left = 70 * (1 - u); right = 70 * u;
      }
      else if (tInCycle < 1300) { left = 0; right = 70; }
      else { left = 0; right = 70 * (1 - (tInCycle - 1300) / 100); }
      return { leftKneeLiftPct: left, rightKneeLiftPct: right };
    },
  };
}

describe('High Knees — happy path', () => {
  it('calibrates within 2.2s and counts 10 alternating reps', () => {
    const { totalMs, intentAt } = happyPathIntent(10);
    const frames = buildFrames(intentAt, buildHighKneesPose, { fps: 30, durationMs: totalMs });

    const result = runHighKneesSession(frames);

    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThanOrEqual(2300);
    expect(result.completedReps.length).toBeGreaterThanOrEqual(10);
    expect(warningsOtherThan(result, 'not-moving').length).toBe(0);
    const avgMqs = result.completedReps.reduce((s, r) => s + r.mqs, 0) / result.completedReps.length;
    expect(avgMqs).toBeGreaterThanOrEqual(60);
  });

  it('reps alternate sides (left/right/left/right…)', () => {
    const { totalMs, intentAt } = happyPathIntent(10);
    const frames = buildFrames(intentAt, buildHighKneesPose, { fps: 30, durationMs: totalMs });
    const result = runHighKneesSession(frames);

    expect(result.completedReps.length).toBeGreaterThanOrEqual(6);
    for (let i = 1; i < result.completedReps.length; i++) {
      expect(result.completedReps[i].side).not.toBe(result.completedReps[i - 1].side);
    }
  });
});
