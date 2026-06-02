import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildObliqueSideBendPose } from '../../harness/pose-stub';
import { runObliqueSideBendSession, warningsOtherThan } from '../../harness/runner';
import type { ObliqueSideBendPoseIntent } from '../../harness/types';

const CAL_MS = 2200;
const REP_MS = 2000;

/** One side-bend rep: rise (600ms) → hold 28° (300ms) → return (600ms) →
 *  upright rest (500ms). Peak 28° clears MIN_REP_LEAN_DEG=18 cleanly. */
function leanMagAt(inRep: number): number {
  if (inRep < 600) return (inRep / 600) * 28;
  if (inRep < 900) return 28;
  if (inRep < 1500) return 28 - ((inRep - 900) / 600) * 28;
  return 0;
}

describe('Oblique Side Bend — happy path', () => {
  it('calibrates fast and counts 6 alternating reps with no bad warnings', () => {
    const reps = 6;
    const frames = buildFrames(
      (tMs): ObliqueSideBendPoseIntent => {
        if (tMs < CAL_MS) return { leanDeg: 0 };
        const t = tMs - CAL_MS;
        const repIdx = Math.floor(t / REP_MS);
        const mag = leanMagAt(t % REP_MS);
        // Alternate: even reps bend right (+), odd reps bend left (−).
        return { leanDeg: repIdx % 2 === 0 ? mag : -mag };
      },
      buildObliqueSideBendPose,
      { fps: 30, durationMs: CAL_MS + reps * REP_MS + 200 },
    );
    const result = runObliqueSideBendSession(frames);

    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThanOrEqual(600);
    expect(result.completedReps.length).toBe(reps);
    expect(warningsOtherThan(result).length).toBe(0);

    const avgMqs = result.completedReps.reduce((s, r) => s + r.mqs, 0) / result.completedReps.length;
    expect(avgMqs).toBeGreaterThanOrEqual(60);

    expect(result.completedReps[0].side).toBe('right');
    expect(result.completedReps[1].side).toBe('left');
  });

  it('counts reps done all to one side', () => {
    const reps = 5;
    const frames = buildFrames(
      (tMs): ObliqueSideBendPoseIntent => {
        if (tMs < CAL_MS) return { leanDeg: 0 };
        return { leanDeg: leanMagAt((tMs - CAL_MS) % REP_MS) }; // always right
      },
      buildObliqueSideBendPose,
      { fps: 30, durationMs: CAL_MS + reps * REP_MS + 200 },
    );
    const result = runObliqueSideBendSession(frames);
    expect(result.completedReps.length).toBe(reps);
    expect(result.completedReps.every((r) => r.side === 'right')).toBe(true);
  });
});
