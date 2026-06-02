/**
 * Mountain Climber — pace metric (P1-4).
 *
 * Verifies that the rep event includes a rolling reps-per-minute pace value.
 * Rep cycle = 1600ms → pace ≈ 60000/1600 ≈ 37 reps/min starting from the second rep.
 *
 * Pace is 0 for the first rep (no prior interval to average), > 0 from the second rep onward.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildMountainClimberPose } from '../../harness/pose-stub';
import { runMountainClimberSession } from '../../harness/runner';
import type { MountainClimberPoseIntent } from '../../harness/types';

const CAL_MS = 500;
const REP_CYCLE_MS = 1600;

function buildIntentAt(tMs: number): MountainClimberPoseIntent {
  if (tMs < CAL_MS) return { kneeHipAngleDeg: 170, side: 'left', bodyLength: 0.55 };
  const tInRep = (tMs - CAL_MS) % REP_CYCLE_MS;
  let angle: number;
  if (tInRep < 500)       angle = 170 - (tInRep / 500) * 120;
  else if (tInRep < 800)  angle = 50;
  else if (tInRep < 1300) angle = 50 + ((tInRep - 800) / 500) * 120;
  else                    angle = 170;
  return { kneeHipAngleDeg: angle, side: 'left', bodyLength: 0.55 };
}

describe('Mountain Climber — pace metric', () => {
  it('pace is 0 on first rep (no prior interval)', () => {
    const totalMs = CAL_MS + 2 * REP_CYCLE_MS;
    const frames = buildFrames(buildIntentAt, buildMountainClimberPose, { fps: 30, durationMs: totalMs });
    const result = runMountainClimberSession(frames);
    expect(result.completedReps.length).toBeGreaterThanOrEqual(1);
    expect(result.completedReps[0].pace).toBe(0);
  });

  it('pace is positive and approximately correct from second rep', () => {
    // REP_CYCLE_MS = 1600ms → pace ≈ 37 reps/min.
    // Allow ±15 reps/min tolerance for EMA timing variation.
    const totalMs = CAL_MS + 4 * REP_CYCLE_MS;
    const frames = buildFrames(buildIntentAt, buildMountainClimberPose, { fps: 30, durationMs: totalMs });
    const result = runMountainClimberSession(frames);
    expect(result.completedReps.length).toBeGreaterThanOrEqual(2);
    const paceRpm = result.completedReps[1].pace;
    expect(paceRpm).toBeGreaterThan(0);
    // 60000/1600 = 37.5 reps/min — allow generous range for timing jitter
    expect(paceRpm).toBeGreaterThanOrEqual(20);
    expect(paceRpm).toBeLessThanOrEqual(60);
  });

  it('pace field is present on every rep event', () => {
    const totalMs = CAL_MS + 5 * REP_CYCLE_MS;
    const frames = buildFrames(buildIntentAt, buildMountainClimberPose, { fps: 30, durationMs: totalMs });
    const result = runMountainClimberSession(frames);
    for (const rep of result.completedReps) {
      expect(typeof rep.pace).toBe('number');
      expect(rep.pace).toBeGreaterThanOrEqual(0);
    }
  });
});
