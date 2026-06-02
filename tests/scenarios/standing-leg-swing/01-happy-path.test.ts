import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildSideLegRaisePose } from '../../harness/pose-stub';
import { runStandingLegSwingSession, warningsOtherThan } from '../../harness/runner';
import type { SideLegRaisePoseIntent } from '../../harness/types';

// Standing Leg Swing reuses the side-leg-raise pose builder (identical per-side
// hip-abduction geometry). One swing on `side`: out (600ms) → peak 35° (300ms)
// → back in (600ms) → rest (500ms). Peak 35° clears MIN_REP_ABDUCTION_DEG=22.
const CAL_MS = 2200;
const REP_MS = 2000;

function abductionAt(inRep: number): number {
  if (inRep < 600) return (inRep / 600) * 35;
  if (inRep < 900) return 35;
  if (inRep < 1500) return 35 - ((inRep - 900) / 600) * 35;
  return 0;
}

function happyIntent(reps: number) {
  return (tMs: number): SideLegRaisePoseIntent => {
    if (tMs < CAL_MS) return { leftAbductionDeg: 0, rightAbductionDeg: 0 };
    const t = tMs - CAL_MS;
    const repIdx = Math.floor(t / REP_MS);
    const inRep = t % REP_MS;
    const abd = abductionAt(inRep);
    return repIdx % 2 === 0
      ? { leftAbductionDeg: abd, rightAbductionDeg: 0 }
      : { leftAbductionDeg: 0, rightAbductionDeg: abd };
  };
}

describe('Standing Leg Swing — happy path', () => {
  it('calibrates fast and counts 6 alternating swings with no bad warnings', () => {
    const reps = 6;
    const frames = buildFrames(happyIntent(reps), buildSideLegRaisePose, {
      fps: 30,
      durationMs: CAL_MS + reps * REP_MS + 200,
    });
    const result = runStandingLegSwingSession(frames);

    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThanOrEqual(600);
    expect(result.completedReps.length).toBe(reps);
    expect(warningsOtherThan(result).length).toBe(0);

    const avgMqs = result.completedReps.reduce((s, r) => s + r.mqs, 0) / result.completedReps.length;
    expect(avgMqs).toBeGreaterThanOrEqual(60);

    expect(result.completedReps[0].side).toBe('left');
    expect(result.completedReps[1].side).toBe('right');
  });

  it('counts swings done all on a single side (unilateral)', () => {
    const reps = 5;
    const frames = buildFrames(
      (tMs): SideLegRaisePoseIntent => {
        if (tMs < CAL_MS) return { leftAbductionDeg: 0, rightAbductionDeg: 0 };
        const inRep = (tMs - CAL_MS) % REP_MS;
        return { leftAbductionDeg: abductionAt(inRep), rightAbductionDeg: 0 };
      },
      buildSideLegRaisePose,
      { fps: 30, durationMs: CAL_MS + reps * REP_MS + 200 },
    );
    const result = runStandingLegSwingSession(frames);
    expect(result.completedReps.length).toBe(reps);
    expect(result.completedReps.every((r) => r.side === 'left')).toBe(true);
  });

  it('counts a brisker swing cadence (faster tempo than the slow side leg raise)', () => {
    // Out 400ms → peak 100ms → in 400ms → rest 300ms = 1200ms cycle. The swing
    // up-phase stays > MIN_REP_DURATION_MS (200) so it counts.
    const REP = 1200;
    const reps = 4;
    const frames = buildFrames(
      (tMs): SideLegRaisePoseIntent => {
        if (tMs < CAL_MS) return { leftAbductionDeg: 0, rightAbductionDeg: 0 };
        const inRep = (tMs - CAL_MS) % REP;
        let abd = 0;
        if (inRep < 400) abd = (inRep / 400) * 35;
        else if (inRep < 500) abd = 35;
        else if (inRep < 900) abd = 35 - ((inRep - 500) / 400) * 35;
        return { leftAbductionDeg: abd, rightAbductionDeg: 0 };
      },
      buildSideLegRaisePose,
      { fps: 30, durationMs: CAL_MS + reps * REP + 200 },
    );
    const result = runStandingLegSwingSession(frames);
    expect(result.completedReps.length).toBe(reps);
    expect(warningsOtherThan(result).length).toBe(0);
  });
});
