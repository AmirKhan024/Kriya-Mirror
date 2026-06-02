/**
 * Fix S — recoverable-form vs terminal split. Only ONE thing terminates a
 * wall-sit hold: the user fully stands/slides back up (shoulder Y rises by ≥
 * HOLD_BROKEN_SHOULDER_RISE = 0.12 vs baseline). Everything else (knees
 * straightening, torso leaning off the wall, heel lifting) is a recoverable
 * freeze that doesn't end the workout.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildWallSitPose } from '../../harness/pose-stub';
import { runWallSitSession, countWarnings } from '../../harness/runner';
import type { WallSitPoseIntent } from '../../harness/types';

const CAL_MS = 2200;
const HOLD_START = CAL_MS;

describe('Wall Sit — hold-broken (Fix S terminal split)', () => {
  it('terminates the hold ONCE when shoulder rises ≥ 12% (user stood up)', () => {
    const frames = buildFrames(
      (tMs): WallSitPoseIntent => {
        const intoHold = tMs - HOLD_START;
        const shoulderRise = intoHold < 4000 ? 0 : 0.18;
        return { kneeFlexionDeg: 90, shoulderRise, side: 'left' };
      },
      buildWallSitPose,
      { fps: 30, durationMs: HOLD_START + 8000 },
    );
    const result = runWallSitSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.broken).toBe(true);
    expect(result.brokenAtMs).not.toBeNull();
    expect(result.brokenAtMs!).toBeGreaterThanOrEqual(HOLD_START + 4000);
    expect(result.brokenAtMs!).toBeLessThanOrEqual(HOLD_START + 4200);
    expect(countWarnings(result, 'hold-broken')).toBeGreaterThanOrEqual(1);
  });

  it('does NOT terminate on knee-too-straight alone (Fix S recoverable, not terminal)', () => {
    const frames = buildFrames(
      (tMs): WallSitPoseIntent => {
        const intoHold = tMs - HOLD_START;
        const kneeFlex = intoHold < 3000 ? 90 : 25;
        return { kneeFlexionDeg: kneeFlex, side: 'left' };
      },
      buildWallSitPose,
      { fps: 30, durationMs: HOLD_START + 9000 },
    );
    const result = runWallSitSession(frames);
    expect(result.broken).toBe(false);
    expect(countWarnings(result, 'knee-too-straight')).toBeGreaterThan(0);
    expect(countWarnings(result, 'hold-broken')).toBe(0);
  });

  it('does NOT terminate on torso-too-forward alone (Fix S recoverable)', () => {
    const frames = buildFrames(
      (tMs): WallSitPoseIntent => {
        const intoHold = tMs - HOLD_START;
        const lean = intoHold < 3000 ? 4 : 45;
        return { kneeFlexionDeg: 90, trunkLeanDeg: lean, side: 'left' };
      },
      buildWallSitPose,
      { fps: 30, durationMs: HOLD_START + 9000 },
    );
    const result = runWallSitSession(frames);
    expect(result.broken).toBe(false);
    expect(countWarnings(result, 'torso-too-forward')).toBeGreaterThan(0);
    expect(countWarnings(result, 'hold-broken')).toBe(0);
  });
});
