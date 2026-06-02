/**
 * Fix S split — only shoulder rise terminates the hold (user fully stood up).
 * All form warnings freeze the timer but don't terminate.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildWarriorOnePose } from '../../harness/pose-stub';
import { runWarriorOneSession, countWarnings } from '../../harness/runner';
import type { WarriorOnePoseIntent } from '../../harness/types';

const CAL_MS = 2200;
const HOLD_START = CAL_MS;

describe('Warrior I — hold-broken (Fix S terminal split)', () => {
  it('terminates ONCE when shoulder rises ≥ 15% (user stood up)', () => {
    const frames = buildFrames(
      (tMs): WarriorOnePoseIntent => {
        const intoHold = tMs - HOLD_START;
        const shoulderRise = intoHold < 4000 ? 0 : 0.22;
        return { frontKneeFlexionDeg: 90, shoulderRise };
      },
      buildWarriorOnePose,
      { fps: 30, durationMs: HOLD_START + 8000 },
    );
    const result = runWarriorOneSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.broken).toBe(true);
    expect(result.brokenAtMs).not.toBeNull();
    expect(countWarnings(result, 'hold-broken')).toBeGreaterThanOrEqual(1);
  });

  it('does NOT terminate on front-knee-not-bent-enough alone (Fix S recoverable)', () => {
    const frames = buildFrames(
      (tMs): WarriorOnePoseIntent => {
        const intoHold = tMs - HOLD_START;
        const flex = intoHold < 3000 ? 90 : 35;
        return { frontKneeFlexionDeg: flex };
      },
      buildWarriorOnePose,
      { fps: 30, durationMs: HOLD_START + 8000 },
    );
    const result = runWarriorOneSession(frames);
    expect(result.broken).toBe(false);
    expect(countWarnings(result, 'front-knee-not-bent-enough')).toBeGreaterThan(0);
    expect(countWarnings(result, 'hold-broken')).toBe(0);
  });

  it('does NOT terminate on arms-not-overhead alone (Fix S recoverable)', () => {
    const frames = buildFrames(
      (tMs): WarriorOnePoseIntent => {
        const intoHold = tMs - HOLD_START;
        const armsRaised = intoHold < 3000;
        return { frontKneeFlexionDeg: 90, armsRaised };
      },
      buildWarriorOnePose,
      { fps: 30, durationMs: HOLD_START + 8000 },
    );
    const result = runWarriorOneSession(frames);
    expect(result.broken).toBe(false);
    expect(countWarnings(result, 'arms-not-overhead')).toBeGreaterThan(0);
    expect(countWarnings(result, 'hold-broken')).toBe(0);
  });
});
