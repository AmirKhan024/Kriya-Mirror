/**
 * Robustness: the clean alternating happy path must still count reps under
 * MediaPipe-style per-landmark positional jitter (the other suites are
 * noise-free). EMA smoothing + the rate-limit clamp should absorb it without
 * dropping most reps or firing false forward-fold rejections.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildObliqueSideBendPose } from '../../harness/pose-stub';
import { runObliqueSideBendSession } from '../../harness/runner';
import type { ObliqueSideBendPoseIntent } from '../../harness/types';

const CAL_MS = 2200;
const REP_MS = 2000;

function leanMagAt(inRep: number): number {
  if (inRep < 600) return (inRep / 600) * 28;
  if (inRep < 900) return 28;
  if (inRep < 1500) return 28 - ((inRep - 900) / 600) * 28;
  return 0;
}

describe('Oblique Side Bend — noisy happy path', () => {
  it('counts most of 6 alternating reps under positional noise', () => {
    const reps = 6;
    const frames = buildFrames(
      (tMs): ObliqueSideBendPoseIntent => {
        if (tMs < CAL_MS) return { leanDeg: 0, noise: 0.004, seed: 7 };
        const t = tMs - CAL_MS;
        const repIdx = Math.floor(t / REP_MS);
        const mag = leanMagAt(t % REP_MS);
        return { leanDeg: repIdx % 2 === 0 ? mag : -mag, noise: 0.004, seed: 7 + repIdx };
      },
      buildObliqueSideBendPose,
      { fps: 30, durationMs: CAL_MS + reps * REP_MS + 200 },
    );
    const result = runObliqueSideBendSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.completedReps.length).toBeGreaterThanOrEqual(5);
    expect(result.completedReps.length).toBeLessThanOrEqual(6);
  });
});
