/**
 * Fix S split — only shoulder rise terminates the hold (user stepped away
 * or stooped). Sway and posture-not-aligned freeze the timer but don't
 * terminate.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildMountainPosePose } from '../../harness/pose-stub';
import { runMountainPoseSession, countWarnings } from '../../harness/runner';
import type { MountainPosePoseIntent } from '../../harness/types';

const CAL_MS = 2200;
const HOLD_START = CAL_MS;

describe('Mountain Pose — hold-broken (Fix S terminal split)', () => {
  it('terminates ONCE when shoulder rises ≥ 15% (user stepped away)', () => {
    const frames = buildFrames(
      (tMs): MountainPosePoseIntent => {
        const intoHold = tMs - HOLD_START;
        const shoulderRise = intoHold < 4000 ? 0 : 0.20;
        return { shoulderRise };
      },
      buildMountainPosePose,
      { fps: 30, durationMs: HOLD_START + 8000 },
    );
    const result = runMountainPoseSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.broken).toBe(true);
    expect(result.brokenAtMs).not.toBeNull();
    expect(countWarnings(result, 'hold-broken')).toBeGreaterThanOrEqual(1);
  });

  it('does NOT terminate on posture-not-aligned alone (Fix S recoverable)', () => {
    const frames = buildFrames(
      (tMs): MountainPosePoseIntent => {
        const intoHold = tMs - HOLD_START;
        // Round 20 threshold = 0.45 — use 0.09 tilt → ratio 0.56 above threshold.
        const tilt = intoHold < 3000 ? 0 : 0.09;
        return { shoulderTilt: tilt };
      },
      buildMountainPosePose,
      { fps: 30, durationMs: HOLD_START + 8000 },
    );
    const result = runMountainPoseSession(frames);
    expect(result.broken).toBe(false);
    expect(countWarnings(result, 'posture-not-aligned')).toBeGreaterThan(0);
    expect(countWarnings(result, 'hold-broken')).toBe(0);
  });

  it('does NOT terminate on sustained sway alone (Fix S recoverable)', () => {
    const frames = buildFrames(
      (tMs): MountainPosePoseIntent => {
        const intoHold = tMs - HOLD_START;
        const swayX = intoHold < 3000 ? 0 : 0.025;
        return { swayX };
      },
      buildMountainPosePose,
      { fps: 30, durationMs: HOLD_START + 8000 },
    );
    const result = runMountainPoseSession(frames);
    expect(result.broken).toBe(false);
    expect(countWarnings(result, 'swaying')).toBeGreaterThan(0);
    expect(countWarnings(result, 'hold-broken')).toBe(0);
  });
});
