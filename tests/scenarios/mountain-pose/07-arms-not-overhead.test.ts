/**
 * 2026-05-28 round 19 regression — Tadasana variant requires arms overhead
 * for the duration of the hold. If wrists drop below shoulders mid-hold,
 * the `arms-not-overhead` warning fires (recoverable per Fix S — freezes
 * the timer but doesn't terminate).
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildMountainPosePose } from '../../harness/pose-stub';
import { runMountainPoseSession, countWarnings } from '../../harness/runner';
import type { MountainPosePoseIntent } from '../../harness/types';

const CAL_MS = 2200;
const HOLD_START = CAL_MS;

describe('Mountain Pose — arms-not-overhead warning (Round 19)', () => {
  it('fires arms-not-overhead when wrists drop below shoulders mid-hold', () => {
    const frames = buildFrames(
      (tMs): MountainPosePoseIntent => {
        const intoHold = tMs - HOLD_START;
        // 3s clean (arms overhead) then arms drop to sides.
        return intoHold < 3000 ? {} : { armsRaised: false };
      },
      buildMountainPosePose,
      { fps: 30, durationMs: HOLD_START + 6000 },
    );
    const result = runMountainPoseSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'arms-not-overhead')).toBeGreaterThan(0);
    expect(result.broken).toBe(false);  // recoverable, not terminal
  });

  it('does NOT fire arms-not-overhead on clean hold (arms stay overhead)', () => {
    const frames = buildFrames(
      () => ({} as MountainPosePoseIntent),
      buildMountainPosePose,
      { fps: 30, durationMs: HOLD_START + 5000 },
    );
    const result = runMountainPoseSession(frames);
    expect(countWarnings(result, 'arms-not-overhead')).toBe(0);
  });
});
