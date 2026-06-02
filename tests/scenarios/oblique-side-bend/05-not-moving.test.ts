/**
 * Fix I + Fix P — `not-moving` idle prompt. After calibration confirms, if the
 * user just stands upright (no bends) for ≥ 5s, fire `not-moving`. Fix P: the
 * cold-start cooldown must allow the FIRST fire.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildObliqueSideBendPose } from '../../harness/pose-stub';
import { runObliqueSideBendSession, countWarnings } from '../../harness/runner';
import type { ObliqueSideBendPoseIntent } from '../../harness/types';

const CAL_MS = 2200;
const REP_MS = 2000;

describe('Oblique Side Bend — not-moving idle prompt (Fix I/P)', () => {
  it('fires not-moving after ~5s of standing still post-calibration', () => {
    const frames = buildFrames(
      () => ({ leanDeg: 0 } as ObliqueSideBendPoseIntent),
      buildObliqueSideBendPose,
      { fps: 30, durationMs: 8000 },
    );
    const result = runObliqueSideBendSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'not-moving')).toBeGreaterThanOrEqual(1);
  });

  it('does NOT fire not-moving while actively bending', () => {
    const frames = buildFrames(
      (tMs): ObliqueSideBendPoseIntent => {
        if (tMs < CAL_MS) return { leanDeg: 0 };
        const inRep = (tMs - CAL_MS) % REP_MS;
        let mag = 0;
        if (inRep < 600) mag = (inRep / 600) * 28;
        else if (inRep < 900) mag = 28;
        else if (inRep < 1500) mag = 28 - ((inRep - 900) / 600) * 28;
        return { leanDeg: mag };
      },
      buildObliqueSideBendPose,
      { fps: 30, durationMs: CAL_MS + 3 * REP_MS },
    );
    const result = runObliqueSideBendSession(frames);
    expect(countWarnings(result, 'not-moving')).toBe(0);
  });
});
