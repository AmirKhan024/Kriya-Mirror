/**
 * Robustness: sit-to-stand reps must still count under MediaPipe-style jitter
 * (and confirms the chair/person knee-flex signal survives noise from the side).
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildChairPosePose } from '../../harness/pose-stub';
import { runSitToStandSession } from '../../harness/runner';
import type { ChairPosePoseIntent } from '../../harness/types';

const CAL_MS = 2200;
const REP_MS = 2400;

function kneeFlexAt(inRep: number): number {
  if (inRep < 800) return 90 - (inRep / 800) * 85;
  if (inRep < 1200) return 5;
  if (inRep < 2000) return 5 + ((inRep - 1200) / 800) * 85;
  return 90;
}

describe('Sit-to-Stand — noisy happy path', () => {
  it('counts most of 6 stand-ups under positional noise', () => {
    const reps = 6;
    const frames = buildFrames(
      (tMs): ChairPosePoseIntent => {
        if (tMs < CAL_MS) return { kneeFlexionDeg: 90, side: 'left', noise: 0.004, seed: 3 };
        const repIdx = Math.floor((tMs - CAL_MS) / REP_MS);
        return { kneeFlexionDeg: kneeFlexAt((tMs - CAL_MS) % REP_MS), side: 'left', noise: 0.004, seed: 3 + repIdx };
      },
      buildChairPosePose,
      { fps: 30, durationMs: CAL_MS + reps * REP_MS + 200 },
    );
    const result = runSitToStandSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.completedReps.length).toBeGreaterThanOrEqual(5);
    expect(result.completedReps.length).toBeLessThanOrEqual(6);
  });
});
