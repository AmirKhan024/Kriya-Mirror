/**
 * Fix S split — only shoulder rise > 15 % terminates the hold (user fully
 * stood up). All five form warnings (knees-caving, arms-dropped,
 * knee-too-straight, knee-too-deep, torso-too-forward) freeze the timer
 * but don't terminate.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildGoddessPosePose } from '../../harness/pose-stub';
import { runGoddessPoseSession, countWarnings } from '../../harness/runner';
import type { GoddessPosePoseIntent } from '../../harness/types';

const CAL_MS = 2200;
const HOLD_START = CAL_MS;

describe('Goddess Pose — hold-broken (Fix S terminal split)', () => {
  it('terminates ONCE when shoulder rises ≥ 15% (user stood up)', () => {
    const frames = buildFrames(
      (tMs): GoddessPosePoseIntent => {
        const intoHold = tMs - HOLD_START;
        const shoulderRise = intoHold < 4000 ? 0 : 0.22;
        return { kneeFlexionDeg: 90, shoulderRise };
      },
      buildGoddessPosePose,
      { fps: 30, durationMs: HOLD_START + 8000 },
    );
    const result = runGoddessPoseSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.broken).toBe(true);
    expect(result.brokenAtMs).not.toBeNull();
    expect(countWarnings(result, 'hold-broken')).toBeGreaterThanOrEqual(1);
  });

  it('does NOT terminate on knees-caving alone (Fix S recoverable)', () => {
    const frames = buildFrames(
      (tMs): GoddessPosePoseIntent => {
        const intoHold = tMs - HOLD_START;
        const ratio = intoHold < 3000 ? 1.0 : 0.5;
        return { kneeFlexionDeg: 90, kneeAnkleRatio: ratio };
      },
      buildGoddessPosePose,
      { fps: 30, durationMs: HOLD_START + 8000 },
    );
    const result = runGoddessPoseSession(frames);
    expect(result.broken).toBe(false);
    expect(countWarnings(result, 'knees-caving')).toBeGreaterThan(0);
    expect(countWarnings(result, 'hold-broken')).toBe(0);
  });

  it('does NOT terminate on arms-dropped alone (Fix S recoverable)', () => {
    const frames = buildFrames(
      (tMs): GoddessPosePoseIntent => {
        const intoHold = tMs - HOLD_START;
        const drop = intoHold < 3000 ? 0 : 0.30;
        return { kneeFlexionDeg: 90, elbowDropFraction: drop };
      },
      buildGoddessPosePose,
      { fps: 30, durationMs: HOLD_START + 8000 },
    );
    const result = runGoddessPoseSession(frames);
    expect(result.broken).toBe(false);
    expect(countWarnings(result, 'arms-dropped')).toBeGreaterThan(0);
    expect(countWarnings(result, 'hold-broken')).toBe(0);
  });
});
