/**
 * Rep validation:
 *   - A cycle that arches fully but barely rounds (cat peak below the ROM floor)
 *     is rejected and fires `shallow-spine-rom` — it does NOT count.
 *   - A clean full cat-cow cycle counts with a sensible depthDeg.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildCatCowPose } from '../../harness/pose-stub';
import { runCatCowSession, countWarnings } from '../../harness/runner';
import type { CatCowPoseIntent } from '../../harness/types';

const CAL_MS = 2200;

describe('Cat-Cow — rep validation', () => {
  it('rejects a shallow cycle (cat barely rounds) and fires shallow-spine-rom', () => {
    // Cow arches fully (+30) but the cat only reaches −12° (crosses the ±8 entry
    // so a cycle is detected, but below the 15° ROM floor) → shallow.
    const frames = buildFrames(
      (tMs): CatCowPoseIntent => {
        if (tMs < CAL_MS) return { neckPitchDeg: 0 };
        const t = tMs - CAL_MS;
        let pitch: number;
        if (t < 600) pitch = (t / 600) * 30;
        else if (t < 1800) pitch = 30 - ((t - 600) / 1200) * 42;  // +30 → −12
        else if (t < 2400) pitch = -12 + ((t - 1800) / 600) * 12; // −12 → 0
        else pitch = 0;
        return { neckPitchDeg: pitch };
      },
      buildCatCowPose,
      { fps: 30, durationMs: CAL_MS + 2800 },
    );
    const result = runCatCowSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.completedReps.length).toBe(0);
    expect(countWarnings(result, 'shallow-spine-rom')).toBeGreaterThan(0);
  });

  it('counts a clean full cat-cow cycle', () => {
    const frames = buildFrames(
      (tMs): CatCowPoseIntent => {
        if (tMs < CAL_MS) return { neckPitchDeg: 0 };
        const t = tMs - CAL_MS;
        let pitch: number;
        if (t < 600) pitch = (t / 600) * 30;
        else if (t < 1800) pitch = 30 - ((t - 600) / 1200) * 60;  // +30 → −30
        else if (t < 2400) pitch = -30 + ((t - 1800) / 600) * 30; // −30 → 0
        else pitch = 0;
        return { neckPitchDeg: pitch };
      },
      buildCatCowPose,
      { fps: 30, durationMs: CAL_MS + 2800 },
    );
    const result = runCatCowSession(frames);
    expect(result.completedReps.length).toBe(1);
    expect(result.completedReps[0].depthDeg).toBeGreaterThanOrEqual(40);
    expect(countWarnings(result, 'shallow-spine-rom')).toBe(0);
  });
});
