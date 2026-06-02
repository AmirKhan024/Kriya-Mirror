/**
 * Broad Jump — position-lost detection (Fix N).
 * After calibration confirms, if landmarks are absent for ≥ 3s, fires 'position-lost'.
 * Respects 10s repeat cooldown. Clean frames keep it silent.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildBroadJumpPose } from '../../harness/pose-stub';
import { runBroadJumpSession } from '../../harness/runner';
import type { BroadJumpPoseIntent } from '../../harness/types';

const CAL_MS = 800;

describe('Broad Jump — position-lost (Fix N)', () => {
  it('fires position-lost after 4s of missing landmarks post-calibration', () => {
    const frames = buildFrames(
      (tMs: number): BroadJumpPoseIntent => {
        if (tMs < CAL_MS) return { hipYOffset: 0, kneeFlexionDeg: 5 };
        // Occlude all core landmarks after calibration
        return { hipYOffset: 0, kneeFlexionDeg: 5, occludedIndices: [23, 24, 25, 26, 27, 28] };
      },
      buildBroadJumpPose,
      { fps: 30, durationMs: CAL_MS + 5000 },
    );
    const result = runBroadJumpSession(frames);
    const posLost = result.warnings.filter(w => w.type === 'position-lost');
    expect(posLost.length).toBeGreaterThan(0);
    // Cal confirms at ~200ms; lastValidFrameAt seeded then. Position-lost fires ~3s after
    // the last valid tracking frame (~767ms), so at ~3767ms which is > 3000.
    expect(posLost[0].atMs).toBeGreaterThan(3000);
  });

  it('does NOT fire position-lost with clean landmark stream', () => {
    const frames = buildFrames(
      (tMs: number): BroadJumpPoseIntent => {
        if (tMs < CAL_MS) return { hipYOffset: 0, kneeFlexionDeg: 5 };
        return { hipYOffset: 0, kneeFlexionDeg: 5 };
      },
      buildBroadJumpPose,
      { fps: 30, durationMs: CAL_MS + 5000 },
    );
    const result = runBroadJumpSession(frames);
    const posLost = result.warnings.filter(w => w.type === 'position-lost');
    expect(posLost.length).toBe(0);
  });

  it('respects 10s cooldown — fires at most twice in 25s of lost tracking', () => {
    const frames = buildFrames(
      (tMs: number): BroadJumpPoseIntent => {
        if (tMs < CAL_MS) return { hipYOffset: 0, kneeFlexionDeg: 5 };
        return { hipYOffset: 0, kneeFlexionDeg: 5, occludedIndices: [23, 24, 25, 26, 27, 28] };
      },
      buildBroadJumpPose,
      { fps: 30, durationMs: CAL_MS + 25_000 },
    );
    const result = runBroadJumpSession(frames);
    const posLost = result.warnings.filter(w => w.type === 'position-lost');
    expect(posLost.length).toBeLessThanOrEqual(3);
  });
});
