/**
 * Fix O (round 7): EMA reseed after rep returns to HANGING.
 * After a rep completes, hangingSince resets. Idle detection should not fire
 * immediately after the rep — it must wait another NO_MOVEMENT_TIMEOUT_MS (5 s).
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildPullUpPose } from '../../harness/pose-stub';
import { runPullUpSession, countWarnings } from '../../harness/runner';
import type { PullUpPoseIntent } from '../../harness/types';

const CAL_MS = 2200;
const REP_CYCLE_MS = 3000;

function repFlex(t: number): number {
  if (t < 1000) return (t / 1000) * 130;
  if (t < 1500) return 130;
  if (t < 2500) return 130 - ((t - 1500) / 1000) * 130;
  return 0;
}

describe('Pull-Up — not-moving fires again after completing a rep + idle', () => {
  it('fires not-moving after a rep + 6s idle (idle window resets post-rep)', () => {
    const totalMs = CAL_MS + REP_CYCLE_MS + 8000;
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) return { elbowFlexionDeg: 0 } as PullUpPoseIntent;
        if (tMs < CAL_MS + REP_CYCLE_MS) {
          const t = tMs - CAL_MS;
          return { elbowFlexionDeg: repFlex(t) } as PullUpPoseIntent;
        }
        // Post-rep: stay at dead hang (idle)
        return { elbowFlexionDeg: 0 } as PullUpPoseIntent;
      },
      buildPullUpPose,
      { fps: 30, durationMs: totalMs },
    );
    const result = runPullUpSession(frames);
    expect(result.completedReps.length).toBe(1);
    expect(countWarnings(result, 'not-moving')).toBeGreaterThan(0);
  });

  it('does NOT fire not-moving within 3s after completing a rep', () => {
    const totalMs = CAL_MS + REP_CYCLE_MS + 3000;
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) return { elbowFlexionDeg: 0 } as PullUpPoseIntent;
        if (tMs < CAL_MS + REP_CYCLE_MS) {
          const t = tMs - CAL_MS;
          return { elbowFlexionDeg: repFlex(t) } as PullUpPoseIntent;
        }
        return { elbowFlexionDeg: 0 } as PullUpPoseIntent;
      },
      buildPullUpPose,
      { fps: 30, durationMs: totalMs },
    );
    const result = runPullUpSession(frames);
    expect(result.completedReps.length).toBe(1);
    expect(countWarnings(result, 'not-moving')).toBe(0);
  });
});
