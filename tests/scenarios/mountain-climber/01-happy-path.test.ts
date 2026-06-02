/**
 * Mountain Climber — happy path
 *
 * Calibration in plank position (side-on, body horizontal, arms straight),
 * then a series of clean knee drives. Each drive = 1 rep.
 *
 * Rep cycle profile:
 *   0–500ms:  drive knee 170° → 50° (PLANK → DRIVING → KNEE_AT_CHEST)
 *   500–800ms: hold at 50°
 *   800–1300ms: extend back 50° → 170° (EXTENDING → PLANK)
 *   1300–1600ms: rest in PLANK
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildMountainClimberPose } from '../../harness/pose-stub';
import { runMountainClimberSession, warningsOtherThan } from '../../harness/runner';
import type { MountainClimberPoseIntent } from '../../harness/types';

const CAL_MS = 500;         // instant calibration (CONFIRM_DURATION_MS = 200ms)
const REP_CYCLE_MS = 1600;  // one rep cycle

function mountainClimberIntent(reps: number) {
  const totalMs = CAL_MS + reps * REP_CYCLE_MS;
  const intentAt = (tMs: number): MountainClimberPoseIntent => {
    if (tMs < CAL_MS) {
      // Calibration: plank position, leg extended (PLANK angle)
      return { kneeHipAngleDeg: 170, side: 'left', bodyLength: 0.55 };
    }
    const tInRep = (tMs - CAL_MS) % REP_CYCLE_MS;
    let angle: number;
    if (tInRep < 500) {
      // Drive: 170° → 50°
      angle = 170 - (tInRep / 500) * 120;
    } else if (tInRep < 800) {
      // Hold at chest
      angle = 50;
    } else if (tInRep < 1300) {
      // Extend: 50° → 170°
      angle = 50 + ((tInRep - 800) / 500) * 120;
    } else {
      // Rest in PLANK
      angle = 170;
    }
    return { kneeHipAngleDeg: angle, side: 'left', bodyLength: 0.55 };
  };
  return { totalMs, intentAt };
}

describe('Mountain Climber — happy path', () => {
  it('calibrates quickly and counts 10 clean reps', () => {
    const { totalMs, intentAt } = mountainClimberIntent(10);
    const frames = buildFrames(intentAt, buildMountainClimberPose, { fps: 30, durationMs: totalMs });
    const result = runMountainClimberSession(frames);

    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThanOrEqual(500);
    expect(result.completedReps.length).toBe(10);
    // Only allow not-moving warning (if any)
    expect(warningsOtherThan(result, 'not-moving').length).toBe(0);
    // MQS should be reasonable for clean reps
    const avgMqs = result.completedReps.reduce((s, r) => s + r.mqs, 0) / result.completedReps.length;
    expect(avgMqs).toBeGreaterThanOrEqual(40);
  });

  it('counts 5 reps in a 5-rep stream', () => {
    const { totalMs, intentAt } = mountainClimberIntent(5);
    const frames = buildFrames(intentAt, buildMountainClimberPose, { fps: 30, durationMs: totalMs });
    const result = runMountainClimberSession(frames);
    expect(result.completedReps.length).toBe(5);
  });

  it('works on the right side (camera flipped)', () => {
    const { totalMs } = mountainClimberIntent(5);
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) return { kneeHipAngleDeg: 170, side: 'right' as const, bodyLength: 0.55 };
        const tInRep = (tMs - CAL_MS) % REP_CYCLE_MS;
        let angle: number;
        if (tInRep < 500) angle = 170 - (tInRep / 500) * 120;
        else if (tInRep < 800) angle = 50;
        else if (tInRep < 1300) angle = 50 + ((tInRep - 800) / 500) * 120;
        else angle = 170;
        return { kneeHipAngleDeg: angle, side: 'right' as const, bodyLength: 0.55 };
      },
      buildMountainClimberPose,
      { fps: 30, durationMs: totalMs },
    );
    const result = runMountainClimberSession(frames);
    expect(result.completedReps.length).toBe(5);
  });

  it('each rep has depthDeg below 90 (full drive recorded)', () => {
    const { totalMs, intentAt } = mountainClimberIntent(5);
    const frames = buildFrames(intentAt, buildMountainClimberPose, { fps: 30, durationMs: totalMs });
    const result = runMountainClimberSession(frames);
    for (const rep of result.completedReps) {
      expect(rep.depthDeg).toBeLessThan(90);
    }
  });
});
