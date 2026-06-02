/**
 * Form-warning emission tests. All three wall-sit warnings (knee-too-straight,
 * torso-too-forward, heel-lift) are RECOVERABLE per Fix S — they freeze the
 * hold counter, fire a warning, but do NOT terminate the workout.
 *
 * Wall Sit has NO `knee-too-deep` warning: the wall + vertical shins physically
 * stop the user from sinking below parallel, so that fault can't occur.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildWallSitPose } from '../../harness/pose-stub';
import { runWallSitSession, countWarnings } from '../../harness/runner';
import type { WallSitPoseIntent } from '../../harness/types';

const CAL_MS = 2200;
const HOLD_START = CAL_MS;

describe('Wall Sit — form warnings (recoverable per Fix S)', () => {
  it('fires knee-too-straight when the hips slide up the wall', () => {
    const frames = buildFrames(
      (tMs): WallSitPoseIntent => {
        const intoHold = tMs - HOLD_START;
        // Clean form for the first 5s, then hips rise (knees straighten to 25°,
        // far below the 60° threshold).
        const kneeFlex = intoHold < 5000 ? 90 : 25;
        return { kneeFlexionDeg: kneeFlex, side: 'left' };
      },
      buildWallSitPose,
      { fps: 30, durationMs: HOLD_START + 8000 },
    );
    const result = runWallSitSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'knee-too-straight')).toBeGreaterThan(0);
    expect(result.broken).toBe(false); // recoverable, not terminal
  });

  it('fires torso-too-forward when the user peels off the wall', () => {
    const frames = buildFrames(
      (tMs): WallSitPoseIntent => {
        const intoHold = tMs - HOLD_START;
        const lean = intoHold < 5000 ? 4 : 45; // 45° clearly past the 25° threshold
        return { kneeFlexionDeg: 90, trunkLeanDeg: lean, side: 'left' };
      },
      buildWallSitPose,
      { fps: 30, durationMs: HOLD_START + 8000 },
    );
    const result = runWallSitSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'torso-too-forward')).toBeGreaterThan(0);
    expect(result.broken).toBe(false);
  });

  // 2026-05-31: heel-lift was DROPPED for wall-sit (the side-view ankle Y is too
  // noisy and false-fired instantly in physical testing). No heel-lift test.

  it('does NOT fire any structural warning on clean continuous form', () => {
    const frames = buildFrames(
      () => ({ kneeFlexionDeg: 90, trunkLeanDeg: 6, side: 'left' as const } as WallSitPoseIntent),
      buildWallSitPose,
      { fps: 30, durationMs: HOLD_START + 8000 },
    );
    const result = runWallSitSession(frames);
    expect(countWarnings(result, 'knee-too-straight')).toBe(0);
    expect(countWarnings(result, 'torso-too-forward')).toBe(0);
  });

  // Regression for the physical-test bug: a user who holds at their OWN
  // calibrated depth (here ~90°) with realistic jitter must NOT trip
  // knee-too-straight (the old absolute 60° threshold froze the timer when the
  // calibrated baseline was just above the floor).
  it('does NOT false-fire knee-too-straight while holding steady at the calibrated depth (with noise)', () => {
    const frames = buildFrames(
      () => ({ kneeFlexionDeg: 90, trunkLeanDeg: 5, side: 'left' as const, noise: 0.004, seed: 13 } as WallSitPoseIntent),
      buildWallSitPose,
      { fps: 30, durationMs: HOLD_START + 12_000 },
    );
    const result = runWallSitSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.broken).toBe(false);
    expect(countWarnings(result, 'knee-too-straight')).toBe(0);
    // Timer keeps accumulating valid hold time (not frozen).
    const lastTick = result.holdTicks[result.holdTicks.length - 1];
    expect(lastTick.secondsElapsed).toBeGreaterThanOrEqual(9);
  });

  // Sliding UP out of the wall sit (knee flex drops far below the held depth)
  // still fires knee-too-straight (relative threshold).
  it('fires knee-too-straight when the user rises well above their held depth', () => {
    const frames = buildFrames(
      (tMs): WallSitPoseIntent => {
        const intoHold = tMs - HOLD_START;
        // Hold ~90° for 5s, then rise to ~50° (well below the 90−22=68 slip floor).
        const kneeFlex = intoHold < 5000 ? 90 : 50;
        return { kneeFlexionDeg: kneeFlex, side: 'left' };
      },
      buildWallSitPose,
      { fps: 30, durationMs: HOLD_START + 8000 },
    );
    const result = runWallSitSession(frames);
    expect(countWarnings(result, 'knee-too-straight')).toBeGreaterThan(0);
    expect(result.broken).toBe(false);
  });
});
