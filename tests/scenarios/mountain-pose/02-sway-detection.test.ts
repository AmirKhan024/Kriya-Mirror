/**
 * Sway detection — Mountain Pose uses a 6° threshold (round 20). Round 19
 * had bumped it to 8° to accommodate a calf-raise base of support; round 20
 * rolled the calf raise back, so the base is the user's feet flat together —
 * tighter than SLS (single leg, 12°) but matches tandem-stand (6°).
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildMountainPosePose } from '../../harness/pose-stub';
import { runMountainPoseSession, countWarnings } from '../../harness/runner';
import type { MountainPosePoseIntent } from '../../harness/types';

const CAL_MS = 2200;

describe('Mountain Pose — sway detection (6° threshold)', () => {
  it('fires swaying when CoM displacement exceeds 6°', () => {
    const frames = buildFrames(
      (tMs) => {
        const intoHold = tMs - CAL_MS;
        // Sustained sway via swayX after cal — 0.025 normalized × 1/shoulderWidth(0.16) ≈ 0.156
        // → atan(0.156) ≈ 8.9° → above the 4° threshold.
        const swayX = intoHold > 1500 ? 0.025 : 0;
        return { swayX } as MountainPosePoseIntent;
      },
      buildMountainPosePose,
      { fps: 30, durationMs: CAL_MS + 5000 },
    );
    const result = runMountainPoseSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'swaying')).toBeGreaterThan(0);
    expect(result.broken).toBe(false);
  });

  it('does NOT fire swaying on a clean steady hold', () => {
    const frames = buildFrames(
      () => ({} as MountainPosePoseIntent),
      buildMountainPosePose,
      { fps: 30, durationMs: CAL_MS + 5000 },
    );
    const result = runMountainPoseSession(frames);
    expect(countWarnings(result, 'swaying')).toBe(0);
  });
});
