/**
 * Broad Jump — rep validation.
 * Tests that malformed reps (too short, no real jump, jitter spike) are rejected.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildBroadJumpPose } from '../../harness/pose-stub';
import { runBroadJumpSession } from '../../harness/runner';
import type { BroadJumpPoseIntent } from '../../harness/types';

const CAL_MS = 800;

function makeSession(repSequence: Array<{ tInRep: number; intent: BroadJumpPoseIntent }[]>) {
  const repCycleMs = 1500;
  const totalMs = CAL_MS + repSequence.length * repCycleMs;
  return buildFrames(
    (tMs: number): BroadJumpPoseIntent => {
      if (tMs < CAL_MS) return { hipYOffset: 0, kneeFlexionDeg: 5 };
      const repIdx = Math.floor((tMs - CAL_MS) / repCycleMs);
      const tInRep = (tMs - CAL_MS) % repCycleMs;
      const seq = repSequence[repIdx];
      if (!seq) return { hipYOffset: 0, kneeFlexionDeg: 5 };
      for (let i = seq.length - 1; i >= 0; i--) {
        if (tInRep >= seq[i].tInRep) return seq[i].intent;
      }
      return { hipYOffset: 0, kneeFlexionDeg: 5 };
    },
    buildBroadJumpPose,
    { fps: 30, durationMs: totalMs },
  );
}

describe('Broad Jump — rep validation', () => {
  it('rejects a rep with insufficient hip rise (incomplete-jump)', () => {
    // Tiny hop — hipYOffset only -0.02, below MIN_HIP_RISE=0.05
    const frames = makeSession([[
      { tInRep: 0, intent: { hipYOffset: 0.04, kneeFlexionDeg: 50 } },
      { tInRep: 200, intent: { hipYOffset: -0.02, kneeFlexionDeg: 5 } },
      { tInRep: 500, intent: { hipYOffset: 0, kneeFlexionDeg: 5 } },
    ]]);
    const result = runBroadJumpSession(frames);
    expect(result.completedReps.length).toBe(0);
    const incompleteWarns = result.warnings.filter(w => w.type === 'incomplete-jump');
    expect(incompleteWarns.length).toBeGreaterThan(0);
  });

  it('rejects a too-fast rep (duration < 600ms)', () => {
    // Proper jump height but compressed into 400ms (duration < MIN_REP_DURATION_MS=600).
    // hipYOffset=-0.09 ensures maxHipRise=0.09>MIN_HIP_RISE, so reject reason is too-fast.
    // Landing at -0.06 (NOT -0.04) to avoid IEEE 754 edge case.
    const frames = buildFrames(
      (tMs: number): BroadJumpPoseIntent => {
        if (tMs < CAL_MS) return { hipYOffset: 0, kneeFlexionDeg: 5 };
        const t = tMs - CAL_MS;
        if (t < 50) return { hipYOffset: 0.05, kneeFlexionDeg: 60 };
        if (t < 200) return { hipYOffset: -0.09, kneeFlexionDeg: 5 };
        if (t < 300) return { hipYOffset: -0.06, kneeFlexionDeg: 40 };
        if (t < 500) return { hipYOffset: 0, kneeFlexionDeg: 5 };
        return { hipYOffset: 0, kneeFlexionDeg: 5 };
      },
      buildBroadJumpPose,
      { fps: 30, durationMs: CAL_MS + 1500 },
    );
    const result = runBroadJumpSession(frames);
    expect(result.completedReps.length).toBe(0);
  });

  it('counts a valid rep after a rejected one', () => {
    // Rep 1: tiny hop (rejected), Rep 2: valid.
    // Landing uses -0.06 to avoid the IEEE 754 hipDisp edge case at -0.04.
    const frames = buildFrames(
      (tMs: number): BroadJumpPoseIntent => {
        if (tMs < CAL_MS) return { hipYOffset: 0, kneeFlexionDeg: 5 };
        const t = tMs - CAL_MS;
        // Rep 1: incomplete jump (tiny hop)
        if (t < 200) return { hipYOffset: 0.04, kneeFlexionDeg: 50 };
        if (t < 400) return { hipYOffset: -0.02, kneeFlexionDeg: 5 };
        if (t < 700) return { hipYOffset: 0, kneeFlexionDeg: 5 };
        // Rep 2: valid — loading at t=700, airborne 900-1200, landing 1200-1500, stand 1500+
        if (t < 900) return { hipYOffset: 0.05, kneeFlexionDeg: 60 };
        if (t < 1200) return { hipYOffset: -0.09, kneeFlexionDeg: 5 };
        if (t < 1500) return { hipYOffset: -0.06, kneeFlexionDeg: 45 };
        if (t < 1900) return { hipYOffset: 0, kneeFlexionDeg: 5 };
        return { hipYOffset: 0, kneeFlexionDeg: 5 };
      },
      buildBroadJumpPose,
      { fps: 30, durationMs: CAL_MS + 2800 },
    );
    const result = runBroadJumpSession(frames);
    expect(result.completedReps.length).toBe(1);
  });
});
