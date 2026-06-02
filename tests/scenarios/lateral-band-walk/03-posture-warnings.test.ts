/**
 * Lateral Band Walk — posture warnings.
 * (1) trunk-lean fires when lateral torso lean > 30° during a step
 * (2) hip-drop fires when stepping-side hip Y drops > 6% torsoHeight during step
 * (3) steps-not-tracked fires when hip X < 0.08 for 10+ frames
 * (4) trunk-lean debounce: single-frame lean does NOT trigger, 8-frame sustained does
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildLateralBandWalkPose } from '../../harness/pose-stub';
import { runLateralBandWalkSession, countWarnings } from '../../harness/runner';
import type { LateralBandWalkPoseIntent } from '../../harness/types';

const CAL_MS = 300;

describe('Lateral Band Walk — posture warnings', () => {
  it('(1) trunk-lean fires when torso leans > 30° during a step', () => {
    // Simulate a step with excessive lateral trunk lean (> 30°)
    const STEP_MS = 1500;
    const TOTAL_MS = CAL_MS + STEP_MS + 500;
    const frames = buildFrames(
      (tMs): LateralBandWalkPoseIntent => {
        if (tMs < CAL_MS) return { hipXDisplacement: 0 };
        const t = tMs - CAL_MS;
        if (t < STEP_MS) {
          // Active step with bad trunk lean — displacement raised to 0.18 to exceed new STEP_CONFIRM_THRESHOLD=0.15
          const displacement = t < 750
            ? (t / 750) * 0.18
            : 0.18 - ((t - 750) / 750) * 0.18;
          return {
            hipXDisplacement: displacement,
            stepDirection: 'right',
            trunkLeanDeg: 40, // > 30° threshold
          };
        }
        return { hipXDisplacement: 0 };
      },
      buildLateralBandWalkPose,
      { fps: 30, durationMs: TOTAL_MS },
    );

    const result = runLateralBandWalkSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'trunk-lean')).toBeGreaterThan(0);
  });

  it('(2) hip-drop fires when stepping-side hip drops > 6% torsoHeight during step', () => {
    const STEP_MS = 1500;
    const TOTAL_MS = CAL_MS + STEP_MS + 500;
    const frames = buildFrames(
      (tMs): LateralBandWalkPoseIntent => {
        if (tMs < CAL_MS) return { hipXDisplacement: 0 };
        const t = tMs - CAL_MS;
        if (t < STEP_MS) {
          // Displacement raised to 0.18 (new CONFIRM=0.15); hipDropRatio raised to 0.10 (new threshold=0.08)
          const displacement = t < 750
            ? (t / 750) * 0.18
            : 0.18 - ((t - 750) / 750) * 0.18;
          return {
            hipXDisplacement: displacement,
            stepDirection: 'right',
            hipDropRatio: 0.10, // > HIP_DROP_THRESHOLD of 0.08
          };
        }
        return { hipXDisplacement: 0 };
      },
      buildLateralBandWalkPose,
      { fps: 30, durationMs: TOTAL_MS },
    );

    const result = runLateralBandWalkSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'hip-drop')).toBeGreaterThan(0);
  });

  it('(3) steps-not-tracked fires when hip X near left edge (< 0.08) for 10+ frames', () => {
    // After calibration, simulate user walking to the left edge of frame
    const TOTAL_MS = CAL_MS + 2000;
    const frames = buildFrames(
      (tMs): LateralBandWalkPoseIntent => {
        if (tMs < CAL_MS) return { hipXDisplacement: 0 };
        // Simulate near-edge position (hip X near left edge < 0.08)
        return {
          hipXDisplacement: 0,
          isNearEdge: true,  // signals the builder to place hip near frame edge
        };
      },
      buildLateralBandWalkPose,
      { fps: 30, durationMs: TOTAL_MS },
    );

    const result = runLateralBandWalkSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    // After 10+ frames near edge, should fire 'steps-not-tracked'
    expect(countWarnings(result, 'steps-not-tracked')).toBeGreaterThan(0);
  });

  it('(4) trunk-lean debounce: single-frame lean does NOT trigger warning', () => {
    // Only a brief 2-frame trunk lean — should not trigger (needs 8 sustained frames)
    const TOTAL_MS = CAL_MS + 3000;
    let framesSinceStep = 0;
    const frames = buildFrames(
      (tMs): LateralBandWalkPoseIntent => {
        if (tMs < CAL_MS) return { hipXDisplacement: 0 };
        framesSinceStep++;
        const t = tMs - CAL_MS;
        if (t < 1500) {
          // Active step
          const displacement = t < 750
            ? (t / 750) * 0.06
            : 0.06 - ((t - 750) / 750) * 0.06;
          // Apply trunk lean ONLY for frames 5-6 (2 frames, far below 8-frame debounce)
          const shortLean = (framesSinceStep >= 5 && framesSinceStep <= 6) ? 40 : 0;
          return {
            hipXDisplacement: displacement,
            stepDirection: 'right',
            trunkLeanDeg: shortLean,
          };
        }
        return { hipXDisplacement: 0 };
      },
      buildLateralBandWalkPose,
      { fps: 30, durationMs: TOTAL_MS },
    );

    const result = runLateralBandWalkSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    // 2 frames of lean is below the 8-frame debounce — should NOT trigger warning
    expect(countWarnings(result, 'trunk-lean')).toBe(0);
  });
});
