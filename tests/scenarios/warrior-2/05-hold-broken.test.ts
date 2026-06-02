/**
 * Fix S split — only shoulder rise terminates the hold (user fully stood up).
 * All four form warnings freeze the timer but don't terminate.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildWarriorTwoPose } from '../../harness/pose-stub';
import { runWarriorTwoSession, countWarnings } from '../../harness/runner';
import type { WarriorTwoPoseIntent } from '../../harness/types';

const CAL_MS = 2200;
const HOLD_START = CAL_MS;

describe('Warrior II — hold-broken (Fix S terminal split)', () => {
  it('terminates ONCE when shoulder rises ≥ 15% (user stood up)', () => {
    const frames = buildFrames(
      (tMs): WarriorTwoPoseIntent => {
        const intoHold = tMs - HOLD_START;
        const shoulderRise = intoHold < 4000 ? 0 : 0.22;
        return { frontKneeFlexionDeg: 90, shoulderRise };
      },
      buildWarriorTwoPose,
      { fps: 30, durationMs: HOLD_START + 8000 },
    );
    const result = runWarriorTwoSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.broken).toBe(true);
    expect(result.brokenAtMs).not.toBeNull();
    expect(countWarnings(result, 'hold-broken')).toBeGreaterThanOrEqual(1);
  });

  it('does NOT terminate on front-knee-not-bent-enough alone (Fix S recoverable)', () => {
    const frames = buildFrames(
      (tMs): WarriorTwoPoseIntent => {
        const intoHold = tMs - HOLD_START;
        const flex = intoHold < 3000 ? 90 : 35;  // round-19: was 50, now below the new 50° threshold
        return { frontKneeFlexionDeg: flex };
      },
      buildWarriorTwoPose,
      { fps: 30, durationMs: HOLD_START + 8000 },
    );
    const result = runWarriorTwoSession(frames);
    expect(result.broken).toBe(false);
    expect(countWarnings(result, 'front-knee-not-bent-enough')).toBeGreaterThan(0);
    expect(countWarnings(result, 'hold-broken')).toBe(0);
  });

  it('does NOT terminate on back-knee-bent alone (Fix S recoverable)', () => {
    const frames = buildFrames(
      (tMs): WarriorTwoPoseIntent => {
        const intoHold = tMs - HOLD_START;
        const backFlex = intoHold < 3000 ? 5 : 40;
        return { frontKneeFlexionDeg: 90, backKneeFlexionDeg: backFlex };
      },
      buildWarriorTwoPose,
      { fps: 30, durationMs: HOLD_START + 8000 },
    );
    const result = runWarriorTwoSession(frames);
    expect(result.broken).toBe(false);
    expect(countWarnings(result, 'back-knee-bent')).toBeGreaterThan(0);
    expect(countWarnings(result, 'hold-broken')).toBe(0);
  });
});
