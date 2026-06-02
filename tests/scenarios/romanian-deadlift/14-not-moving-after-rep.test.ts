/**
 * Romanian Deadlift — not-moving re-arms after rep completion.
 * After completing a rep, the standingSince timer resets. If user then
 * stands still for another 5s, a new not-moving warning should fire.
 * Fix O: EMA-decay reseed prevents false-positives during EMA tail after rep.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames, concatFrames } from '../../harness/frame-stream';
import { buildRomanianDeadliftPose } from '../../harness/pose-stub';
import { runRDLSession, countWarnings } from '../../harness/runner';
import type { RomanianDeadliftPoseIntent } from '../../harness/types';

function standingFrames(durationMs: number) {
  return buildFrames(
    (): RomanianDeadliftPoseIntent => ({ hipHingeDeg: 0, kneeAngleDeg: 15 }),
    buildRomanianDeadliftPose,
    { fps: 30, durationMs },
  );
}

describe('Romanian Deadlift — not-moving after rep', () => {
  it('fires not-moving if idle > 5s after completing a rep', () => {
    // Calibration 1s → one rep 3s → idle 8s
    const calFrames = standingFrames(1000);
    const repFrames = buildFrames(
      (tMs): RomanianDeadliftPoseIntent => {
        if (tMs < 1000) return { hipHingeDeg: (tMs / 1000) * 65, kneeAngleDeg: 15 };
        if (tMs < 1500) return { hipHingeDeg: 65, kneeAngleDeg: 15 };
        return { hipHingeDeg: 65 - ((tMs - 1500) / 1000) * 65, kneeAngleDeg: 15 };
      },
      buildRomanianDeadliftPose,
      { fps: 30, durationMs: 3000 },
    );
    const idleFrames = standingFrames(8000);
    const frames = concatFrames(calFrames, repFrames, idleFrames);
    const result = runRDLSession(frames);

    expect(result.completedReps.length).toBe(1);
    expect(countWarnings(result, 'not-moving')).toBeGreaterThan(0);
  });

  it('does NOT fire not-moving immediately after rep due to EMA decay tail (Fix O)', () => {
    // Calibration 1s → one rep 3s → 2s idle (less than 5s threshold)
    const calFrames = standingFrames(1000);
    const repFrames = buildFrames(
      (tMs): RomanianDeadliftPoseIntent => {
        if (tMs < 1000) return { hipHingeDeg: (tMs / 1000) * 65, kneeAngleDeg: 15 };
        if (tMs < 1500) return { hipHingeDeg: 65, kneeAngleDeg: 15 };
        return { hipHingeDeg: 65 - ((tMs - 1500) / 1000) * 65, kneeAngleDeg: 15 };
      },
      buildRomanianDeadliftPose,
      { fps: 30, durationMs: 3000 },
    );
    const shortIdleFrames = standingFrames(2000);
    const frames = concatFrames(calFrames, repFrames, shortIdleFrames);
    const result = runRDLSession(frames);

    expect(result.completedReps.length).toBe(1);
    expect(countWarnings(result, 'not-moving')).toBe(0);
  });
});
