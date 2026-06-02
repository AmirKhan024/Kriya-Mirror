/**
 * Jump Squat — not-moving after rep (Fix O).
 * After a real rep, EMA decays from the hip-rise peak back toward rest.
 * Without Fix O, the variance in STANDING state after a rep never drops below
 * the threshold and not-moving never fires.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildJumpSquatPose } from '../../harness/pose-stub';
import { runJumpSquatSession } from '../../harness/runner';
import type { JumpSquatPoseIntent } from '../../harness/types';

const CAL_MS = 800;

describe('Jump Squat — not-moving after rep (Fix O)', () => {
  it('fires not-moving after one rep followed by 8s idle', () => {
    const REP_END_MS = 1800;
    const frames = buildFrames(
      (tMs: number): JumpSquatPoseIntent => {
        if (tMs < CAL_MS) return { hipYOffset: 0, kneeFlexionDeg: 5 };
        const t = tMs - CAL_MS;
        // One complete rep
        if (t < 200) return { hipYOffset: 0.05, kneeFlexionDeg: 60 };
        if (t < 500) return { hipYOffset: -0.09, kneeFlexionDeg: 5 };
        if (t < 800) return { hipYOffset: -0.06, kneeFlexionDeg: 50 };  // -0.06 avoids IEEE 754 edge case at -0.04
        if (t < REP_END_MS) return { hipYOffset: 0, kneeFlexionDeg: 5 };
        // Long idle after rep
        return { hipYOffset: 0, kneeFlexionDeg: 5 };
      },
      buildJumpSquatPose,
      { fps: 30, durationMs: CAL_MS + REP_END_MS + 9000 },
    );
    const result = runJumpSquatSession(frames);
    expect(result.completedReps.length).toBe(1);
    const notMoving = result.warnings.filter(w => w.type === 'not-moving');
    expect(notMoving.length).toBeGreaterThan(0);
    // Must fire well after the rep ended
    expect(notMoving[0].atMs).toBeGreaterThan(CAL_MS + REP_END_MS + 500);
  });
});
