import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildSupermanPose } from '../../harness/pose-stub';
import { runSupermanSession, countWarnings } from '../../harness/runner';
import type { SupermanPoseIntent } from '../../harness/types';

const CAL_MS = 300;

describe('Superman — discard bad-form reps', () => {
  it('incomplete-superman fires when shoulderRise peak < 0.06', () => {
    // Peak shoulderRise = 0.04 — above RISE_ENTER_THRESHOLD=0.03 so RISING state is reached,
    // but below MIN_SHOULDER_RISE=0.06 so rep is rejected as 'incomplete-superman'.
    const repCycleMs = 2000;
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) {
          return { shoulderRise: 0, armsForward: true } as SupermanPoseIntent;
        }
        const tInRep = (tMs - CAL_MS) % repCycleMs;
        let rise: number;
        if (tInRep < 600)  rise = (tInRep / 600) * 0.04;
        else if (tInRep < 1000) rise = 0.04;
        else if (tInRep < 1600) rise = 0.04 - ((tInRep - 1000) / 600) * 0.04;
        else rise = 0;
        return { shoulderRise: rise, armsForward: true } as SupermanPoseIntent;
      },
      buildSupermanPose,
      { fps: 30, durationMs: CAL_MS + 5 * repCycleMs + 300 },
    );
    const result = runSupermanSession(frames);
    // No reps should be counted
    expect(result.completedReps.length).toBe(0);
    // incomplete-superman should fire
    expect(countWarnings(result, 'incomplete-superman')).toBeGreaterThan(0);
  });

  it('incomplete-superman warning is included in rep.warnings for rejected reps', () => {
    // Run a borderline shallow rep: shoulderRise = 0.04 (above RISE_ENTER_THRESHOLD=0.03
    // but below MIN=0.06). The warning fires via onPostureWarning.
    const repCycleMs = 1500;
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) {
          return { shoulderRise: 0, armsForward: true } as SupermanPoseIntent;
        }
        const tInRep = (tMs - CAL_MS) % repCycleMs;
        const rise = tInRep < 750
          ? (tInRep / 750) * 0.04
          : 0.04 - ((tInRep - 750) / 750) * 0.04;
        return { shoulderRise: Math.max(0, rise), armsForward: true } as SupermanPoseIntent;
      },
      buildSupermanPose,
      { fps: 30, durationMs: CAL_MS + 3 * repCycleMs },
    );
    const result = runSupermanSession(frames);
    expect(countWarnings(result, 'incomplete-superman')).toBeGreaterThan(0);
  });
});
