/**
 * `not-moving` idle prompt for wall-sit. Fires when form has been broken for
 * ≥ 5 s; repeats every 15 s.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildWallSitPose } from '../../harness/pose-stub';
import { runWallSitSession, countWarnings } from '../../harness/runner';
import type { WallSitPoseIntent } from '../../harness/types';

const CAL_MS = 2200;
const HOLD_START = CAL_MS;

describe('Wall Sit — not-moving idle prompt', () => {
  it('fires not-moving after 5 s of sustained form-break (hips slid up)', () => {
    const frames = buildFrames(
      (tMs): WallSitPoseIntent => {
        const intoHold = tMs - HOLD_START;
        const kneeFlex = intoHold < 1000 ? 90 : 25;
        return { kneeFlexionDeg: kneeFlex, side: 'left' };
      },
      buildWallSitPose,
      { fps: 30, durationMs: HOLD_START + 10_000 },
    );
    const result = runWallSitSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'not-moving')).toBeGreaterThan(0);
  });

  it('repeats not-moving every ~15 s while still broken', () => {
    const frames = buildFrames(
      (tMs): WallSitPoseIntent => {
        const intoHold = tMs - HOLD_START;
        const kneeFlex = intoHold < 1000 ? 90 : 25;
        return { kneeFlexionDeg: kneeFlex, side: 'left' };
      },
      buildWallSitPose,
      { fps: 30, durationMs: HOLD_START + 25_000 },
    );
    const result = runWallSitSession(frames);
    expect(countWarnings(result, 'not-moving')).toBeGreaterThanOrEqual(2);
  });

  it('does NOT fire not-moving on a clean hold', () => {
    const frames = buildFrames(
      (): WallSitPoseIntent => ({ kneeFlexionDeg: 90, side: 'left' }),
      buildWallSitPose,
      { fps: 30, durationMs: HOLD_START + 10_000 },
    );
    const result = runWallSitSession(frames);
    expect(countWarnings(result, 'not-moving')).toBe(0);
  });

  it('does NOT fire not-moving when form recovers within 5 s', () => {
    const frames = buildFrames(
      (tMs): WallSitPoseIntent => {
        const intoHold = tMs - HOLD_START;
        const kneeFlex = (intoHold >= 1000 && intoHold < 4000) ? 25 : 90;
        return { kneeFlexionDeg: kneeFlex, side: 'left' };
      },
      buildWallSitPose,
      { fps: 30, durationMs: HOLD_START + 10_000 },
    );
    const result = runWallSitSession(frames);
    expect(countWarnings(result, 'not-moving')).toBe(0);
  });
});
