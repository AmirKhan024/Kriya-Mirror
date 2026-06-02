/**
 * Regression test for Fix A on Jumping Jacks: posture warnings (torso-swing)
 * must NOT fire while the user is resting in CLOSED between reps.
 *
 * Fix (engine.ts): gate `maybeEmitWarning('torso-swing')` to
 * `repState !== 'CLOSED'`.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildJumpingJacksPose } from '../../harness/pose-stub';
import { runJumpingJacksSession, countWarnings } from '../../harness/runner';
import type { JumpingJacksPoseIntent } from '../../harness/types';

const CAL_MS = 2200;

describe('Jumping Jacks — posture warning gating (only fire when not CLOSED)', () => {
  it('does NOT fire torso-swing while user holds CLOSED with bad form', () => {
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) {
          return { armOpennessPct: 0, legOpennessPct: 30 } as JumpingJacksPoseIntent;
        }
        // Post-cal: still in CLOSED (no jack) but with sustained torso sway.
        return {
          armOpennessPct: 0,
          legOpennessPct: 30,
          torsoSwayX: 0.06,
        } as JumpingJacksPoseIntent;
      },
      buildJumpingJacksPose,
      { fps: 30, durationMs: CAL_MS + 5000 },
    );

    const result = runJumpingJacksSession(frames);
    expect(countWarnings(result, 'torso-swing')).toBe(0);
  });

  it('DOES fire torso-swing once the user enters OPEN with bad form', () => {
    const repCycleMs = 2000;
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) {
          return { armOpennessPct: 0, legOpennessPct: 30 } as JumpingJacksPoseIntent;
        }
        const tInRep = (tMs - CAL_MS) % repCycleMs;
        let arm: number, leg: number;
        if (tInRep < 500) { arm = (tInRep / 500) * 100; leg = 30 + (tInRep / 500) * 70; }
        else if (tInRep < 1000) { arm = 100; leg = 100; }
        else if (tInRep < 1500) { arm = 100 - ((tInRep - 1000) / 500) * 100; leg = 100 - ((tInRep - 1000) / 500) * 70; }
        else { arm = 0; leg = 30; }
        const inActive = arm > 20;
        return {
          armOpennessPct: arm,
          legOpennessPct: leg,
          torsoSwayX: inActive ? 0.06 : 0,
        } as JumpingJacksPoseIntent;
      },
      buildJumpingJacksPose,
      { fps: 30, durationMs: CAL_MS + 2 * repCycleMs },
    );

    const result = runJumpingJacksSession(frames);
    expect(countWarnings(result, 'torso-swing')).toBeGreaterThan(0);
  });
});
