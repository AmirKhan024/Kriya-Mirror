import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildChairPosePose } from '../../harness/pose-stub';
import { runSitToStandSession, warningsOtherThan } from '../../harness/runner';
import type { ChairPosePoseIntent } from '../../harness/types';

// Sit-to-stand reuses the side-view chair-pose builder: kneeFlexionDeg ~90 =
// seated, ~5 = standing. Each rep = sit → stand → sit.
const CAL_MS = 2200;
const REP_MS = 2400;

function kneeFlexAt(inRep: number): number {
  if (inRep < 800) return 90 - (inRep / 800) * 85;          // rise: 90 → 5
  if (inRep < 1200) return 5;                                // standing hold
  if (inRep < 2000) return 5 + ((inRep - 1200) / 800) * 85;  // sit: 5 → 90
  return 90;                                                  // seated rest
}

describe('Sit-to-Stand — happy path', () => {
  it('calibrates seated and counts 6 stand-ups', () => {
    const reps = 6;
    const frames = buildFrames(
      (tMs): ChairPosePoseIntent => {
        if (tMs < CAL_MS) return { kneeFlexionDeg: 90, side: 'left' };
        return { kneeFlexionDeg: kneeFlexAt((tMs - CAL_MS) % REP_MS), side: 'left' };
      },
      buildChairPosePose,
      { fps: 30, durationMs: CAL_MS + reps * REP_MS + 200 },
    );
    const result = runSitToStandSession(frames);

    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThanOrEqual(600);
    expect(result.completedReps.length).toBe(reps);
    expect(warningsOtherThan(result).length).toBe(0);

    const avgMqs = result.completedReps.reduce((s, r) => s + r.mqs, 0) / result.completedReps.length;
    expect(avgMqs).toBeGreaterThanOrEqual(60);
    // depthDeg = knee-extension range; a full stand covers most of ~85°.
    expect(result.completedReps[0].depthDeg).toBeGreaterThanOrEqual(55);
  });
});
