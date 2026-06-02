/**
 * Broad Jump — not-moving init (Fix I + Fix P).
 * After calibration confirms, the engine seeds standingSince = now.
 * After 5s idle, 'not-moving' fires. Cold-start cooldown allows the FIRST fire.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildBroadJumpPose } from '../../harness/pose-stub';
import { runBroadJumpSession } from '../../harness/runner';
import type { BroadJumpPoseIntent } from '../../harness/types';

const CAL_MS = 800;

describe('Broad Jump — not-moving init (Fix I + Fix P)', () => {
  it('fires not-moving after 5s idle post-calibration', () => {
    const frames = buildFrames(
      (tMs: number): BroadJumpPoseIntent => {
        if (tMs < CAL_MS) return { hipYOffset: 0, kneeFlexionDeg: 5 };
        return { hipYOffset: 0, kneeFlexionDeg: 5 };
      },
      buildBroadJumpPose,
      { fps: 30, durationMs: CAL_MS + 6500 },
    );
    const result = runBroadJumpSession(frames);
    const notMoving = result.warnings.filter(w => w.type === 'not-moving');
    expect(notMoving.length).toBeGreaterThan(0);
    // Must fire after cal confirmed
    expect(notMoving[0].atMs).toBeGreaterThan(CAL_MS);
  });

  it('does NOT fire not-moving if user is doing reps', () => {
    const frames = buildFrames(
      (tMs: number): BroadJumpPoseIntent => {
        if (tMs < CAL_MS) return { hipYOffset: 0, kneeFlexionDeg: 5 };
        const t = tMs - CAL_MS;
        const tInRep = t % 1800;
        if (tInRep < 200) return { hipYOffset: 0.05, kneeFlexionDeg: 60 };
        if (tInRep < 500) return { hipYOffset: -0.09, kneeFlexionDeg: 5 };
        if (tInRep < 800) return { hipYOffset: -0.04, kneeFlexionDeg: 50 };
        return { hipYOffset: 0, kneeFlexionDeg: 5 };
      },
      buildBroadJumpPose,
      { fps: 30, durationMs: CAL_MS + 7000 },
    );
    const result = runBroadJumpSession(frames);
    const notMoving = result.warnings.filter(w => w.type === 'not-moving');
    expect(notMoving.length).toBe(0);
  });
});
