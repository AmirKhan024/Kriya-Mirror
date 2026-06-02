/**
 * `not-moving` idle prompt for Warrior I.
 *
 * Fires when form has been broken for ≥ 5 s; repeats every 15 s.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildWarriorOnePose } from '../../harness/pose-stub';
import { runWarriorOneSession, countWarnings } from '../../harness/runner';
import type { WarriorOnePoseIntent } from '../../harness/types';

const CAL_MS = 2200;
const HOLD_START = CAL_MS;

describe('Warrior I — not-moving idle prompt', () => {
  it('fires not-moving after 5 s of sustained form-break (front knee straight)', () => {
    const frames = buildFrames(
      (tMs): WarriorOnePoseIntent => {
        const intoHold = tMs - HOLD_START;
        const flex = intoHold < 1000 ? 90 : 30;
        return { frontKneeFlexionDeg: flex };
      },
      buildWarriorOnePose,
      { fps: 30, durationMs: HOLD_START + 10_000 },
    );
    const result = runWarriorOneSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'not-moving')).toBeGreaterThan(0);
  });

  it('repeats not-moving every ~15 s while still broken', () => {
    const frames = buildFrames(
      (tMs): WarriorOnePoseIntent => {
        const intoHold = tMs - HOLD_START;
        const flex = intoHold < 1000 ? 90 : 30;
        return { frontKneeFlexionDeg: flex };
      },
      buildWarriorOnePose,
      { fps: 30, durationMs: HOLD_START + 25_000 },
    );
    const result = runWarriorOneSession(frames);
    expect(countWarnings(result, 'not-moving')).toBeGreaterThanOrEqual(2);
  });

  it('does NOT fire not-moving on a clean hold', () => {
    const frames = buildFrames(
      (): WarriorOnePoseIntent => ({ frontKneeFlexionDeg: 90 }),
      buildWarriorOnePose,
      { fps: 30, durationMs: HOLD_START + 10_000 },
    );
    const result = runWarriorOneSession(frames);
    expect(countWarnings(result, 'not-moving')).toBe(0);
  });

  it('does NOT fire not-moving when form recovers within 5 s', () => {
    const frames = buildFrames(
      (tMs): WarriorOnePoseIntent => {
        const intoHold = tMs - HOLD_START;
        const flex = (intoHold >= 1000 && intoHold < 4000) ? 30 : 90;
        return { frontKneeFlexionDeg: flex };
      },
      buildWarriorOnePose,
      { fps: 30, durationMs: HOLD_START + 10_000 },
    );
    const result = runWarriorOneSession(frames);
    expect(countWarnings(result, 'not-moving')).toBe(0);
  });
});
