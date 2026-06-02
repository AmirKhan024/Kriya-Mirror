/**
 * Posture-not-aligned warning fires when the combined deviation
 * (shoulder-levelness + hip-levelness + spine-vertical) exceeds 0.45
 * (round 20 — was 0.30 in round 19, but real users had natural anatomical
 * asymmetry summing 0.15-0.30, putting the old threshold at the noise ceiling).
 * Each component is normalized by shoulderWidth (~0.16).
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildMountainPosePose } from '../../harness/pose-stub';
import { runMountainPoseSession, countWarnings } from '../../harness/runner';
import type { MountainPosePoseIntent } from '../../harness/types';

const CAL_MS = 2200;
const HOLD_START = CAL_MS;

describe('Mountain Pose — posture-not-aligned warning', () => {
  it('fires posture-not-aligned when shoulders tilt significantly', () => {
    const frames = buildFrames(
      (tMs): MountainPosePoseIntent => {
        const intoHold = tMs - HOLD_START;
        // After cal, big shoulder tilt: 0.09 / 0.16 ≈ 0.56 → above 0.45 threshold.
        const tilt = intoHold > 1500 ? 0.09 : 0;
        return { shoulderTilt: tilt };
      },
      buildMountainPosePose,
      { fps: 30, durationMs: HOLD_START + 6000 },
    );
    const result = runMountainPoseSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'posture-not-aligned')).toBeGreaterThan(0);
    expect(result.broken).toBe(false);
  });

  it('fires posture-not-aligned when spine drifts laterally (off-vertical)', () => {
    const frames = buildFrames(
      (tMs): MountainPosePoseIntent => {
        const intoHold = tMs - HOLD_START;
        const offset = intoHold > 1500 ? 0.09 : 0;
        return { spineOffsetX: offset };
      },
      buildMountainPosePose,
      { fps: 30, durationMs: HOLD_START + 6000 },
    );
    const result = runMountainPoseSession(frames);
    expect(countWarnings(result, 'posture-not-aligned')).toBeGreaterThan(0);
  });

  it('does NOT fire posture-not-aligned on clean alignment', () => {
    const frames = buildFrames(
      () => ({} as MountainPosePoseIntent),
      buildMountainPosePose,
      { fps: 30, durationMs: HOLD_START + 5000 },
    );
    const result = runMountainPoseSession(frames);
    expect(countWarnings(result, 'posture-not-aligned')).toBe(0);
  });

  it('does NOT fire posture-not-aligned for sub-threshold misalignment', () => {
    // Small shoulder tilt 0.015 → ratio 0.094 → well under 0.30 even combined.
    const frames = buildFrames(
      () => ({ shoulderTilt: 0.015 } as MountainPosePoseIntent),
      buildMountainPosePose,
      { fps: 30, durationMs: HOLD_START + 5000 },
    );
    const result = runMountainPoseSession(frames);
    expect(countWarnings(result, 'posture-not-aligned')).toBe(0);
  });
});
