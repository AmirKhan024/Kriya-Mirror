import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildSquatPose } from '../../harness/pose-stub';
import { runSquatSession, countWarnings } from '../../harness/runner';
import type { SquatPoseIntent } from '../../harness/types';

const CAL_MS = 2200;

describe('Squat — no-movement detection', () => {
  it('fires not-moving after ~12s of idle standing post-calibration', () => {
    const frames = buildFrames(
      () => ({ kneeFlexionDeg: 0, feetWidthRatio: 1.25, armsOverhead: true } as SquatPoseIntent),
      buildSquatPose,
      { fps: 30, durationMs: CAL_MS + 14_000 },
    );
    const result = runSquatSession(frames);
    expect(countWarnings(result, 'not-moving')).toBeGreaterThan(0);
  });

  it('does NOT fire not-moving if user starts squatting before timeout', () => {
    const cycleMs = 3000;
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) return { kneeFlexionDeg: 0, feetWidthRatio: 1.25, armsOverhead: true } as SquatPoseIntent;
        const tInRep = (tMs - CAL_MS) % cycleMs;
        let flex: number;
        if (tInRep < 1000) flex = (tInRep / 1000) * 100;
        else if (tInRep < 1500) flex = 100;
        else if (tInRep < 2500) flex = 100 - ((tInRep - 1500) / 1000) * 100;
        else flex = 0;
        return { kneeFlexionDeg: flex, feetWidthRatio: 1.25, armsOverhead: false } as SquatPoseIntent;
      },
      buildSquatPose,
      { fps: 30, durationMs: CAL_MS + 5 * cycleMs },
    );
    const result = runSquatSession(frames);
    expect(countWarnings(result, 'not-moving')).toBe(0);
  });
});
