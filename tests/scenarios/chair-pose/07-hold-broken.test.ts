/**
 * Fix S — recoverable-form vs terminal split. Only ONE thing terminates a
 * chair-pose hold: the user fully stands back up (shoulder Y rises by ≥
 * HOLD_BROKEN_SHOULDER_RISE = 0.12 vs baseline). Everything else (knees
 * straightening, torso leaning forward, heel lifting) is a recoverable
 * freeze that doesn't end the workout.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildChairPosePose } from '../../harness/pose-stub';
import { runChairPoseSession, countWarnings } from '../../harness/runner';
import type { ChairPosePoseIntent } from '../../harness/types';

const CAL_MS = 2200;
const HOLD_START = CAL_MS;

describe('Chair Pose — hold-broken (Fix S terminal split)', () => {
  it('terminates the hold ONCE when shoulder rises ≥ 12% (user stood up)', () => {
    const frames = buildFrames(
      (tMs): ChairPosePoseIntent => {
        const intoHold = tMs - HOLD_START;
        // 4s clean hold, then user stands fully back up.
        const shoulderRise = intoHold < 4000 ? 0 : 0.18;
        return { kneeFlexionDeg: 90, shoulderRise, side: 'left' };
      },
      buildChairPosePose,
      { fps: 30, durationMs: HOLD_START + 8000 },
    );
    const result = runChairPoseSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.broken).toBe(true);
    expect(result.brokenAtMs).not.toBeNull();
    // Should terminate near the 4-second mark (allow a frame of slack).
    expect(result.brokenAtMs!).toBeGreaterThanOrEqual(HOLD_START + 4000);
    expect(result.brokenAtMs!).toBeLessThanOrEqual(HOLD_START + 4200);
    expect(countWarnings(result, 'hold-broken')).toBeGreaterThanOrEqual(1);
  });

  it('does NOT terminate on knee-too-straight alone (Fix S recoverable, not terminal)', () => {
    const frames = buildFrames(
      (tMs): ChairPosePoseIntent => {
        const intoHold = tMs - HOLD_START;
        // Sustained knees straight for 6 seconds — without standing up.
        const kneeFlex = intoHold < 3000 ? 90 : 25;
        return { kneeFlexionDeg: kneeFlex, side: 'left' };
      },
      buildChairPosePose,
      { fps: 30, durationMs: HOLD_START + 9000 },
    );
    const result = runChairPoseSession(frames);
    expect(result.broken).toBe(false);
    expect(countWarnings(result, 'knee-too-straight')).toBeGreaterThan(0);
    expect(countWarnings(result, 'hold-broken')).toBe(0);
  });

  it('does NOT terminate on torso-too-forward alone (Fix S recoverable)', () => {
    const frames = buildFrames(
      (tMs): ChairPosePoseIntent => {
        const intoHold = tMs - HOLD_START;
        const lean = intoHold < 3000 ? 5 : 45;
        return { kneeFlexionDeg: 90, trunkLeanDeg: lean, side: 'left' };
      },
      buildChairPosePose,
      { fps: 30, durationMs: HOLD_START + 9000 },
    );
    const result = runChairPoseSession(frames);
    expect(result.broken).toBe(false);
    expect(countWarnings(result, 'torso-too-forward')).toBeGreaterThan(0);
    expect(countWarnings(result, 'hold-broken')).toBe(0);
  });
});
