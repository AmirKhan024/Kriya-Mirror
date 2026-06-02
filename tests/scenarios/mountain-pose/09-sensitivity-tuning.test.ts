/**
 * 2026-05-28 round 20 — sensitivity tuning regression tests.
 *
 * User reported "too many constant warnings" during hold. Round 20:
 *   - posture threshold: 0.30 → 0.45 (absorbs natural anatomical asymmetry)
 *   - sway threshold:    8°   → 6°  (heels-lifted layer removed, base wider)
 *
 * These tests lock the new thresholds: clearly-below stays SILENT, clearly-above
 * fires the warning.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildMountainPosePose } from '../../harness/pose-stub';
import { runMountainPoseSession, countWarnings } from '../../harness/runner';
import type { MountainPosePoseIntent } from '../../harness/types';

const CAL_MS = 2200;
const HOLD_START = CAL_MS;

describe('Mountain Pose — round 20 sensitivity tuning', () => {
  // 0.03 shoulder tilt + 0.03 hip tilt + 0.03 spine offset
  //   = 0.187 + 0.187 + 0.187 = 0.563? Wait — each component is independent.
  // Let me check: each = abs(diff) / shoulderWidth(0.16).
  //   shoulderTilt 0.03 → 0.03/0.16 = 0.187
  //   hipTilt      0.03 → 0.03/0.16 = 0.187
  //   spineOffsetX 0.03 → 0.03/0.16 = 0.187
  // Sum = 0.563 → still above 0.45 even at 0.03 per component.
  // For sub-threshold, use 0.02 per component → 0.125 each → 0.375 total < 0.45.
  it('does NOT fire posture-not-aligned on small natural anatomical asymmetry', () => {
    const frames = buildFrames(
      (): MountainPosePoseIntent => ({
        shoulderTilt: 0.02,
        hipTilt: 0.02,
        spineOffsetX: 0.02,
      }),
      buildMountainPosePose,
      { fps: 30, durationMs: HOLD_START + 6000 },
    );
    const result = runMountainPoseSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'posture-not-aligned')).toBe(0);
  });

  it('fires posture-not-aligned only on clear misalignment (combined deviation > 0.45)', () => {
    const frames = buildFrames(
      (tMs): MountainPosePoseIntent => {
        const intoHold = tMs - HOLD_START;
        // Each component 0.04 → ratio 0.25 → sum 0.75 (clearly above 0.45).
        const k = intoHold > 1500 ? 0.04 : 0;
        return { shoulderTilt: k, hipTilt: k, spineOffsetX: k };
      },
      buildMountainPosePose,
      { fps: 30, durationMs: HOLD_START + 6000 },
    );
    const result = runMountainPoseSession(frames);
    expect(countWarnings(result, 'posture-not-aligned')).toBeGreaterThan(0);
  });

  it('does NOT fire swaying on sway clearly below 6° (~4°)', () => {
    // swayX 0.011 → ratio 0.011/0.16 = 0.069 → atan ≈ 3.9° → below 6° threshold.
    const frames = buildFrames(
      (): MountainPosePoseIntent => ({ swayX: 0.011 }),
      buildMountainPosePose,
      { fps: 30, durationMs: HOLD_START + 6000 },
    );
    const result = runMountainPoseSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'swaying')).toBe(0);
  });

  it('fires swaying on sway clearly above 6° (~8°)', () => {
    // swayX 0.023 → ratio 0.144 → atan ≈ 8.2° → above 6° threshold.
    const frames = buildFrames(
      (tMs): MountainPosePoseIntent => {
        const intoHold = tMs - HOLD_START;
        const sway = intoHold > 1500 ? 0.023 : 0;
        return { swayX: sway };
      },
      buildMountainPosePose,
      { fps: 30, durationMs: HOLD_START + 6000 },
    );
    const result = runMountainPoseSession(frames);
    expect(countWarnings(result, 'swaying')).toBeGreaterThan(0);
  });
});
