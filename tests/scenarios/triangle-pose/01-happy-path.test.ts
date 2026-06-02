import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildTrianglePosePose } from '../../harness/pose-stub';
import { runTrianglePoseSession, warningsOtherThan } from '../../harness/runner';
import type { TrianglePosePoseIntent } from '../../harness/types';

const CAL_MS = 2200;

describe('Triangle Pose — happy path (front-on)', () => {
  it('calibrates within 2.3s and holds for 30s with no warnings', () => {
    const frames = buildFrames(
      () => ({} as TrianglePosePoseIntent),
      buildTrianglePosePose,
      { fps: 30, durationMs: CAL_MS + 30_000 },
    );
    const result = runTrianglePoseSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThanOrEqual(2300);
    expect(result.broken).toBe(false);
    expect(warningsOtherThan(result).length).toBe(0);
    expect(result.holdTicks.length).toBeGreaterThanOrEqual(28);
    const avgMqs = result.holdTicks.reduce((s, t) => s + t.mqs, 0) / result.holdTicks.length;
    expect(avgMqs).toBeGreaterThanOrEqual(85);
  });

  it('reaches target hold of 30s with clean form on the left-front variant', () => {
    const frames = buildFrames(
      () => ({ frontLeg: 'left' as const } as TrianglePosePoseIntent),
      buildTrianglePosePose,
      { fps: 30, durationMs: CAL_MS + 32_000 },
    );
    const result = runTrianglePoseSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    const lastTick = result.holdTicks[result.holdTicks.length - 1];
    expect(lastTick.secondsElapsed).toBeGreaterThanOrEqual(28);
  });

  // Regression for the 2026-05-28 physical-test failure: a real user's
  // triangle isn't textbook-straight. Knees soften ~12°, the top arm drifts
  // a few degrees from vertical, and the hand reaches the shin (not the toe).
  // None of these should fire warnings.
  it('does NOT fire form warnings on a real-world less-textbook hold', () => {
    const frames = buildFrames(
      () => ({
        frontKneeFlexionDeg: 12,
        backKneeFlexionDeg: 12,
        topArmTiltDeg: 12,
        bottomArmLiftFromAnkle: 0.10,  // hand at shin height
      } as TrianglePosePoseIntent),
      buildTrianglePosePose,
      { fps: 30, durationMs: CAL_MS + 30_000 },
    );
    const result = runTrianglePoseSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.broken).toBe(false);
    expect(warningsOtherThan(result).length).toBe(0);
    const lastTick = result.holdTicks[result.holdTicks.length - 1];
    expect(lastTick.secondsElapsed).toBeGreaterThanOrEqual(28);
  });
});
