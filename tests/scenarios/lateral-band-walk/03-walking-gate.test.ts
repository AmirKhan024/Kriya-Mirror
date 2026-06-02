/**
 * Lateral Band Walk — walking gate (BUG-LBW-11).
 *
 * Verifies that forward-walking lateral hip sway does NOT count as steps,
 * while genuine lateral band walk steps (both feet on floor) DO count.
 *
 * The discriminator is ankle Y asymmetry:
 *   - Walking: one ankle raised → |leftAnkle.y - rightAnkle.y| > ANKLE_Y_ASYM_THRESHOLD (0.04)
 *   - Lateral shuffle: both ankles near floor → difference < 0.02
 */
import { describe, it, expect } from 'vitest';
import { buildFrames, concatFrames } from '../../harness/frame-stream';
import { buildLateralBandWalkPose } from '../../harness/pose-stub';
import { runLateralBandWalkSession, countWarnings } from '../../harness/runner';
import type { LateralBandWalkPoseIntent } from '../../harness/types';

const CAL_MS = 300;

// Helper: simulate one walking step (high hip sway + one foot raised)
// hipXDisplacement: 0.20 (> STEP_CONFIRM_THRESHOLD = 0.15)
// walkingAnkleRaise: 0.08 (8% frame height — well above ANKLE_Y_ASYM_THRESHOLD = 0.04)
function walkingStepFrames(
  durationMs: number,
  direction: 'left' | 'right',
) {
  const sign = direction === 'right' ? 1 : -1;
  return buildFrames(
    (tMs): LateralBandWalkPoseIntent => {
      if (tMs < CAL_MS) return { hipXDisplacement: 0 };
      const t = tMs - CAL_MS;
      // Ramp hip displacement up to 0.20, hold, return — full walking sway
      let disp: number;
      if (t < 400) {
        disp = (t / 400) * 0.20;
      } else if (t < 800) {
        disp = 0.20;
      } else {
        disp = 0.20 - ((t - 800) / 400) * 0.20;
      }
      return {
        hipXDisplacement: sign * disp,
        stepDirection: direction,
        // Simulate walking: right ankle raised throughout the step
        walkingAnkleRaise: 0.08,
      };
    },
    buildLateralBandWalkPose,
    { fps: 30, durationMs: CAL_MS + durationMs },
  );
}

// Helper: simulate a clean lateral band walk step (both feet on floor)
// Adds 600ms of settled still frames after the step so the EMA decays below STEP_RESET_THRESHOLD.
function lateralShuffleFrames(
  durationMs: number,
  direction: 'left' | 'right',
) {
  const sign = direction === 'right' ? 1 : -1;
  const TAIL_MS = 600;
  return buildFrames(
    (tMs): LateralBandWalkPoseIntent => {
      if (tMs < CAL_MS) return { hipXDisplacement: 0 };
      const t = tMs - CAL_MS;
      if (t < 400) return { hipXDisplacement: sign * (t / 400) * 0.18, walkingAnkleRaise: 0 };
      if (t < 800) return { hipXDisplacement: sign * 0.18, walkingAnkleRaise: 0 };
      if (t < 1200) return { hipXDisplacement: sign * (0.18 - ((t - 800) / 400) * 0.18), walkingAnkleRaise: 0 };
      // Settled tail — displacement back to 0, EMA drains below STEP_RESET_THRESHOLD (0.04)
      return { hipXDisplacement: 0, walkingAnkleRaise: 0 };
    },
    buildLateralBandWalkPose,
    { fps: 30, durationMs: CAL_MS + durationMs + TAIL_MS },
  );
}

describe('Lateral Band Walk — walking gate (BUG-LBW-11)', () => {
  it('(1) forward walking with large ankle Y asymmetry → 0 steps counted', () => {
    // 3 "walking steps" with high hip displacement AND one foot raised
    // Each walking step: 1200ms duration, displacement 0.20 (above CONFIRM threshold)
    // walkingAnkleRaise: 0.08 — well above ANKLE_Y_ASYM_THRESHOLD (0.04)
    const frames = concatFrames(
      walkingStepFrames(1200, 'right'),
      walkingStepFrames(1200, 'left'),
      walkingStepFrames(1200, 'right'),
    );

    const result = runLateralBandWalkSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    // Walking steps must NOT be counted — this is the core fix
    expect(result.completedReps.length).toBe(0);
  });

  it('(2) lateral shuffle with both feet on floor → steps counted normally', () => {
    // 3 clean lateral band walk steps — both ankles on floor (walkingAnkleRaise = 0)
    // Displacement 0.18 (above CONFIRM threshold = 0.15)
    const frames = concatFrames(
      lateralShuffleFrames(1200, 'right'),
      lateralShuffleFrames(1200, 'left'),
      lateralShuffleFrames(1200, 'right'),
    );

    const result = runLateralBandWalkSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    // Lateral shuffles with both feet on floor MUST count
    expect(result.completedReps.length).toBe(3);
  });

  it('(3) walking detected mid-step (raised ankle appears after entry) → step aborted', () => {
    // Step starts with both feet on floor (passes entry gate),
    // then one ankle rises (simulates person losing form and walking) → aborted.
    const TOTAL_MS = CAL_MS + 2000;
    const frames = buildFrames(
      (tMs): LateralBandWalkPoseIntent => {
        if (tMs < CAL_MS) return { hipXDisplacement: 0 };
        const t = tMs - CAL_MS;
        if (t < 200) {
          // First 200ms: both feet on floor — passes entry gate
          return { hipXDisplacement: (t / 200) * 0.10, walkingAnkleRaise: 0 };
        }
        if (t < 1000) {
          // Then foot raises (walking detected mid-step)
          return { hipXDisplacement: 0.20, walkingAnkleRaise: 0.08 };
        }
        return { hipXDisplacement: 0, walkingAnkleRaise: 0 };
      },
      buildLateralBandWalkPose,
      { fps: 30, durationMs: TOTAL_MS },
    );

    const result = runLateralBandWalkSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    // Step must be aborted when walking detected mid-step
    expect(result.completedReps.length).toBe(0);
  });

  it('(4) borderline ankle raise (below threshold) → step is NOT rejected', () => {
    // walkingAnkleRaise = 0.02 — below ANKLE_Y_ASYM_THRESHOLD (0.04)
    // Simulates the trailing foot micro-lift of a proper lateral shuffle
    const TOTAL_MS = CAL_MS + 1500;
    const frames = buildFrames(
      (tMs): LateralBandWalkPoseIntent => {
        if (tMs < CAL_MS) return { hipXDisplacement: 0 };
        const t = tMs - CAL_MS;
        if (t < 500) return { hipXDisplacement: (t / 500) * 0.18, walkingAnkleRaise: 0.02 };
        if (t < 900) return { hipXDisplacement: 0.18, walkingAnkleRaise: 0.02 };
        return { hipXDisplacement: 0.18 - ((t - 900) / 600) * 0.18, walkingAnkleRaise: 0 };
      },
      buildLateralBandWalkPose,
      { fps: 30, durationMs: TOTAL_MS },
    );

    const result = runLateralBandWalkSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    // A small ankle lift (shuffle trailing-foot micro-lift) must NOT block the step
    expect(result.completedReps.length).toBe(1);
  });
});
