/**
 * Mountain Climber — warning gating during PLANK state (Fix A)
 *
 * Hip-sag and hip-pike warnings MUST NOT fire when repState === 'PLANK'
 * (i.e. while the user is resting between drives). The engine gates these
 * warnings to active rep phases only (DRIVING, KNEE_AT_CHEST, EXTENDING).
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildMountainClimberPose } from '../../harness/pose-stub';
import { runMountainClimberSession, countWarnings } from '../../harness/runner';
import type { MountainClimberPoseIntent } from '../../harness/types';

const CAL_MS = 500;

describe('Mountain Climber — warning gating in PLANK state (Fix A)', () => {
  it('hip-sag does NOT fire while repState === PLANK (angle stays > 140°)', () => {
    // User never starts a drive. Stays in PLANK with persistent hip sag.
    // The engine should never fire hip-sag because it only fires in active rep phases.
    const TOTAL_MS = CAL_MS + 6000;
    const frames = buildFrames(
      (tMs): MountainClimberPoseIntent => {
        // Calibration period — perfect form
        if (tMs < CAL_MS) return { kneeHipAngleDeg: 170, hipDeviation: 0, bodyLength: 0.55 };
        // After calibration: stays in PLANK (angle 165°) with persistent hip sag
        return { kneeHipAngleDeg: 165, hipDeviation: 0.10, bodyLength: 0.55 };
      },
      buildMountainClimberPose,
      { fps: 30, durationMs: TOTAL_MS },
    );
    const result = runMountainClimberSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    // Zero hip-sag warnings — gated to active rep only
    expect(countWarnings(result, 'hip-sag')).toBe(0);
    expect(countWarnings(result, 'hip-pike')).toBe(0);
  });

  it('hip-pike does NOT fire while repState === PLANK', () => {
    const TOTAL_MS = CAL_MS + 6000;
    const frames = buildFrames(
      (tMs): MountainClimberPoseIntent => {
        if (tMs < CAL_MS) return { kneeHipAngleDeg: 170, hipDeviation: 0, bodyLength: 0.55 };
        // Stays in PLANK with persistent hip pike
        return { kneeHipAngleDeg: 165, hipDeviation: -0.10, bodyLength: 0.55 };
      },
      buildMountainClimberPose,
      { fps: 30, durationMs: TOTAL_MS },
    );
    const result = runMountainClimberSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'hip-pike')).toBe(0);
    expect(countWarnings(result, 'hip-sag')).toBe(0);
  });

  it('hip-sag DOES fire when the same deviation occurs during an active drive', () => {
    // One full drive with hip sag → should fire
    const DRIVE_MS = 500;
    const HOLD_MS = 800;
    const RETURN_MS = 500;
    const TOTAL_MS = CAL_MS + DRIVE_MS + HOLD_MS + RETURN_MS + 500;
    const frames = buildFrames(
      (tMs): MountainClimberPoseIntent => {
        if (tMs < CAL_MS) return { kneeHipAngleDeg: 170, hipDeviation: 0, bodyLength: 0.55 };
        const t = tMs - CAL_MS;
        let angle: number;
        if (t < DRIVE_MS) angle = 170 - (t / DRIVE_MS) * 120;
        else if (t < DRIVE_MS + HOLD_MS) angle = 50;
        else if (t < DRIVE_MS + HOLD_MS + RETURN_MS)
          angle = 50 + ((t - DRIVE_MS - HOLD_MS) / RETURN_MS) * 120;
        else angle = 170;
        const inActiveDrive = t < DRIVE_MS + HOLD_MS + RETURN_MS;
        return {
          kneeHipAngleDeg: angle,
          hipDeviation: inActiveDrive ? 0.10 : 0,
          bodyLength: 0.55,
        };
      },
      buildMountainClimberPose,
      { fps: 30, durationMs: TOTAL_MS },
    );
    const result = runMountainClimberSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'hip-sag')).toBeGreaterThanOrEqual(1);
  });
});
