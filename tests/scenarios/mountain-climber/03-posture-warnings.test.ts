/**
 * Mountain Climber — posture warnings (hip-sag and hip-pike)
 *
 * Hip-sag fires when hipDeviation > HIP_SAG_THRESHOLD (0.04) for HIP_DEBOUNCE_FRAMES (6) frames.
 * Hip-pike fires when hipDeviation < -HIP_PIKE_THRESHOLD (-0.04).
 * Both must only fire during an active rep (repState !== 'PLANK') — Fix A.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildMountainClimberPose } from '../../harness/pose-stub';
import { runMountainClimberSession, countWarnings } from '../../harness/runner';
import type { MountainClimberPoseIntent } from '../../harness/types';

const CAL_MS = 500;
const DRIVE_DOWN_MS = 500;   // time to reach KNEE_AT_CHEST
const HOLD_MS = 800;         // hold in active rep (so warnings have time to accumulate)
const RETURN_MS = 500;
const REST_MS = 400;

describe('Mountain Climber — posture warnings', () => {
  it('hip-sag fires during active rep phase (deviation 0.08 > threshold 0.04)', () => {
    // Profile: calibrate → drive knee forward (active rep) with persistent hip sag
    const TOTAL_MS = CAL_MS + DRIVE_DOWN_MS + HOLD_MS + RETURN_MS + REST_MS;
    const frames = buildFrames(
      (tMs): MountainClimberPoseIntent => {
        if (tMs < CAL_MS) return { kneeHipAngleDeg: 170, bodyLength: 0.55 };
        const tInRep = tMs - CAL_MS;
        const inDrive = tInRep < DRIVE_DOWN_MS;
        const inHold = tInRep >= DRIVE_DOWN_MS && tInRep < DRIVE_DOWN_MS + HOLD_MS;
        const inReturn = tInRep >= DRIVE_DOWN_MS + HOLD_MS
          && tInRep < DRIVE_DOWN_MS + HOLD_MS + RETURN_MS;

        let angle: number;
        if (inDrive) angle = 170 - (tInRep / DRIVE_DOWN_MS) * 120;  // 170 → 50
        else if (inHold) angle = 50;
        else if (inReturn) angle = 50 + ((tInRep - DRIVE_DOWN_MS - HOLD_MS) / RETURN_MS) * 120;
        else angle = 170;

        const deviation = (inDrive || inHold || inReturn) ? 0.08 : 0;
        return { kneeHipAngleDeg: angle, hipDeviation: deviation, bodyLength: 0.55 };
      },
      buildMountainClimberPose,
      { fps: 30, durationMs: TOTAL_MS },
    );
    const result = runMountainClimberSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'hip-sag')).toBeGreaterThanOrEqual(1);
  });

  it('hip-pike fires during active rep phase (deviation -0.08 < -threshold -0.04)', () => {
    const TOTAL_MS = CAL_MS + DRIVE_DOWN_MS + HOLD_MS + RETURN_MS + REST_MS;
    const frames = buildFrames(
      (tMs): MountainClimberPoseIntent => {
        if (tMs < CAL_MS) return { kneeHipAngleDeg: 170, bodyLength: 0.55 };
        const tInRep = tMs - CAL_MS;
        const inDrive = tInRep < DRIVE_DOWN_MS;
        const inHold = tInRep >= DRIVE_DOWN_MS && tInRep < DRIVE_DOWN_MS + HOLD_MS;
        const inReturn = tInRep >= DRIVE_DOWN_MS + HOLD_MS
          && tInRep < DRIVE_DOWN_MS + HOLD_MS + RETURN_MS;

        let angle: number;
        if (inDrive) angle = 170 - (tInRep / DRIVE_DOWN_MS) * 120;
        else if (inHold) angle = 50;
        else if (inReturn) angle = 50 + ((tInRep - DRIVE_DOWN_MS - HOLD_MS) / RETURN_MS) * 120;
        else angle = 170;

        const deviation = (inDrive || inHold || inReturn) ? -0.08 : 0;
        return { kneeHipAngleDeg: angle, hipDeviation: deviation, bodyLength: 0.55 };
      },
      buildMountainClimberPose,
      { fps: 30, durationMs: TOTAL_MS },
    );
    const result = runMountainClimberSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'hip-pike')).toBeGreaterThanOrEqual(1);
  });

  it('neither hip-sag nor hip-pike fires when deviation is within threshold (0.02)', () => {
    // Drive + hold with minimal deviation (below threshold)
    const TOTAL_MS = CAL_MS + DRIVE_DOWN_MS + HOLD_MS + RETURN_MS + REST_MS;
    const frames = buildFrames(
      (tMs): MountainClimberPoseIntent => {
        if (tMs < CAL_MS) return { kneeHipAngleDeg: 170, bodyLength: 0.55 };
        const tInRep = tMs - CAL_MS;
        let angle: number;
        if (tInRep < DRIVE_DOWN_MS) angle = 170 - (tInRep / DRIVE_DOWN_MS) * 120;
        else if (tInRep < DRIVE_DOWN_MS + HOLD_MS) angle = 50;
        else if (tInRep < DRIVE_DOWN_MS + HOLD_MS + RETURN_MS)
          angle = 50 + ((tInRep - DRIVE_DOWN_MS - HOLD_MS) / RETURN_MS) * 120;
        else angle = 170;
        return { kneeHipAngleDeg: angle, hipDeviation: 0.02, bodyLength: 0.55 };
      },
      buildMountainClimberPose,
      { fps: 30, durationMs: TOTAL_MS },
    );
    const result = runMountainClimberSession(frames);
    expect(countWarnings(result, 'hip-sag')).toBe(0);
    expect(countWarnings(result, 'hip-pike')).toBe(0);
  });
});
