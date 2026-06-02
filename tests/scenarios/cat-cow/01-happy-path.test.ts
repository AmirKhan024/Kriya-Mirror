import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildCatCowPose } from '../../harness/pose-stub';
import { runCatCowSession, warningsOtherThan } from '../../harness/runner';
import type { CatCowPoseIntent } from '../../harness/types';

// 2.2 s calibration (side-on, on all fours, head neutral), then N full cat↔cow
// cycles. Each 2.4 s cycle: cow arch 0→+30° (600ms) → round to cat +30→−30°
// (1200ms, through neutral) → return −30→0° (600ms). The rep completes when the
// head returns to neutral having hit both extremes.
const CAL_MS = 2200;
const REP_MS = 2400;

function pitchAt(inRep: number): number {
  if (inRep < 600) return (inRep / 600) * 30;
  if (inRep < 1800) return 30 - ((inRep - 600) / 1200) * 60;
  return -30 + ((inRep - 1800) / 600) * 30;
}

function happyIntent(reps: number) {
  return (tMs: number): CatCowPoseIntent => {
    if (tMs < CAL_MS) return { neckPitchDeg: 0 };
    const inRep = (tMs - CAL_MS) % REP_MS;
    return { neckPitchDeg: pitchAt(inRep) };
  };
}

describe('Cat-Cow — happy path', () => {
  it('calibrates fast and counts 4 full cat-cow cycles with no bad warnings', () => {
    const reps = 4;
    const frames = buildFrames(happyIntent(reps), buildCatCowPose, {
      fps: 30,
      durationMs: CAL_MS + reps * REP_MS + 400,
    });
    const result = runCatCowSession(frames);

    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThanOrEqual(600);
    expect(result.completedReps.length).toBe(reps);
    expect(warningsOtherThan(result, 'not-moving').length).toBe(0);

    const avgMqs = result.completedReps.reduce((s, r) => s + r.mqs, 0) / result.completedReps.length;
    expect(avgMqs).toBeGreaterThanOrEqual(55);
    // depthDeg ≈ total swing (cow peak + cat peak) ≈ 60°.
    expect(result.completedReps[0].depthDeg).toBeGreaterThanOrEqual(40);
  });

  it('also works with the right side facing the camera', () => {
    const reps = 3;
    const frames = buildFrames(
      (tMs): CatCowPoseIntent => {
        if (tMs < CAL_MS) return { neckPitchDeg: 0, side: 'right' };
        const inRep = (tMs - CAL_MS) % REP_MS;
        return { neckPitchDeg: pitchAt(inRep), side: 'right' };
      },
      buildCatCowPose,
      { fps: 30, durationMs: CAL_MS + reps * REP_MS + 400 },
    );
    const result = runCatCowSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.completedReps.length).toBe(reps);
  });
});
