/**
 * Round 20 — `not-moving` idle prompt for warrior-2.
 *
 * Fires when form has been broken for ≥ 5 s; repeats every 15 s.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildWarriorTwoPose } from '../../harness/pose-stub';
import { runWarriorTwoSession, countWarnings } from '../../harness/runner';
import type { WarriorTwoPoseIntent } from '../../harness/types';

const CAL_MS = 2200;
const HOLD_START = CAL_MS;

describe('Warrior II — not-moving idle prompt (round 20)', () => {
  it('fires not-moving after 5 s of sustained form-break (front knee straight)', () => {
    const frames = buildFrames(
      (tMs): WarriorTwoPoseIntent => {
        const intoHold = tMs - HOLD_START;
        // Cal-confirm at 90° flex, then user straightens front knee (form-break).
        const flex = intoHold < 1000 ? 90 : 30;
        return { frontKneeFlexionDeg: flex };
      },
      buildWarriorTwoPose,
      { fps: 30, durationMs: HOLD_START + 10_000 },
    );
    const result = runWarriorTwoSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'not-moving')).toBeGreaterThan(0);
  });

  it('repeats not-moving every ~15 s while still broken', () => {
    const frames = buildFrames(
      (tMs): WarriorTwoPoseIntent => {
        const intoHold = tMs - HOLD_START;
        const flex = intoHold < 1000 ? 90 : 30;
        return { frontKneeFlexionDeg: flex };
      },
      buildWarriorTwoPose,
      { fps: 30, durationMs: HOLD_START + 25_000 },
    );
    const result = runWarriorTwoSession(frames);
    expect(countWarnings(result, 'not-moving')).toBeGreaterThanOrEqual(2);
  });

  it('does NOT fire not-moving on a clean hold', () => {
    const frames = buildFrames(
      (): WarriorTwoPoseIntent => ({ frontKneeFlexionDeg: 90 }),
      buildWarriorTwoPose,
      { fps: 30, durationMs: HOLD_START + 10_000 },
    );
    const result = runWarriorTwoSession(frames);
    expect(countWarnings(result, 'not-moving')).toBe(0);
  });

  it('does NOT fire not-moving when form recovers within 5 s', () => {
    const frames = buildFrames(
      (tMs): WarriorTwoPoseIntent => {
        const intoHold = tMs - HOLD_START;
        const flex = (intoHold >= 1000 && intoHold < 4000) ? 30 : 90;
        return { frontKneeFlexionDeg: flex };
      },
      buildWarriorTwoPose,
      { fps: 30, durationMs: HOLD_START + 10_000 },
    );
    const result = runWarriorTwoSession(frames);
    expect(countWarnings(result, 'not-moving')).toBe(0);
  });
});
