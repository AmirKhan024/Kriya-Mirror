/**
 * Fix I + Fix P — the idle `not-moving` prompt fires from a cold start: the
 * user calibrates (wide stance) then stands still without squatting.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildCossackSquatPose } from '../../harness/pose-stub';
import { runCossackSquatSession, countWarnings } from '../../harness/runner';
import type { CossackSquatPoseIntent } from '../../harness/types';

const CAL_MS = 2200;

describe('Cossack Squat — not-moving from cold start (Fix I + Fix P)', () => {
  it('fires not-moving after ~5s of standing still post-calibration', () => {
    const frames = buildFrames(
      (): CossackSquatPoseIntent => ({ workingKneeFlexionDeg: 0, workingSide: 'left', hipShift: 0, feetWidthRatio: 1.8, armsAtSides: true }),
      buildCossackSquatPose,
      { fps: 30, durationMs: CAL_MS + 8000 },
    );
    const result = runCossackSquatSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'not-moving')).toBeGreaterThanOrEqual(1);
  });

  it('does NOT fire not-moving instantly on the first post-cal frame', () => {
    const frames = buildFrames(
      (): CossackSquatPoseIntent => ({ workingKneeFlexionDeg: 0, workingSide: 'left', hipShift: 0, feetWidthRatio: 1.8, armsAtSides: true }),
      buildCossackSquatPose,
      { fps: 30, durationMs: CAL_MS + 2000 },
    );
    const result = runCossackSquatSession(frames);
    expect(countWarnings(result, 'not-moving')).toBe(0);
  });
});
