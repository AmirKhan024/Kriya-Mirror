/**
 * Fix I + Fix P — `not-moving` idle prompt. After calibration confirms, if the
 * user stays still on all fours (no cat-cow flow) for ≥ 5 s → `not-moving`
 * (Fix P cold-start cooldown allows the first fire). Must NOT fire while
 * actively flowing through cycles.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildCatCowPose } from '../../harness/pose-stub';
import { runCatCowSession, countWarnings } from '../../harness/runner';
import type { CatCowPoseIntent } from '../../harness/types';

const CAL_MS = 2200;
const REP_MS = 2400;

function pitchAt(inRep: number): number {
  if (inRep < 600) return (inRep / 600) * 30;
  if (inRep < 1800) return 30 - ((inRep - 600) / 1200) * 60;
  return -30 + ((inRep - 1800) / 600) * 30;
}

describe('Cat-Cow — not-moving idle prompt (Fix I/P)', () => {
  it('fires not-moving after ~5s of holding the neutral position', () => {
    const frames = buildFrames(
      () => ({ neckPitchDeg: 0 } as CatCowPoseIntent),
      buildCatCowPose,
      { fps: 30, durationMs: CAL_MS + 8000 },
    );
    const result = runCatCowSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'not-moving')).toBeGreaterThanOrEqual(1);
  });

  it('does NOT fire not-moving while the user is actively flowing', () => {
    const reps = 3;
    const frames = buildFrames(
      (tMs): CatCowPoseIntent => {
        if (tMs < CAL_MS) return { neckPitchDeg: 0 };
        const inRep = (tMs - CAL_MS) % REP_MS;
        return { neckPitchDeg: pitchAt(inRep) };
      },
      buildCatCowPose,
      { fps: 30, durationMs: CAL_MS + reps * REP_MS },
    );
    const result = runCatCowSession(frames);
    expect(countWarnings(result, 'not-moving')).toBe(0);
  });
});
