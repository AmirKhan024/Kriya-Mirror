/**
 * Round 20: torso-swing CHIP/SPEECH emission is now DISABLED entirely for
 * lateral-raise (form-score still tracks shoulder drift via repFormCounts,
 * but the user no longer sees a chip for it). This test verifies the disable
 * is total — neither resting in DOWN nor actively raising fires a chip.
 *
 * Pre-round-20 this file tested Fix A's "no posture warnings during DOWN" gate.
 * The Fix A gate code is still present in the engine (other warnings still
 * respect it); only torso-swing's emit call was removed.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildLateralRaisePose } from '../../harness/pose-stub';
import { runLateralRaiseSession, countWarnings } from '../../harness/runner';
import type { LateralRaisePoseIntent } from '../../harness/types';

const CAL_MS = 2200;

describe('Lateral Raise — posture warning gating (only fire when not DOWN)', () => {
  it('does NOT fire torso-swing while user holds DOWN with bad form', () => {
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) {
          return { abductionDeg: 0 } as LateralRaisePoseIntent;
        }
        // Post-cal: still in DOWN (no raise) but with a sustained torso sway.
        return {
          abductionDeg: 0,
          torsoSwayX: 0.06,    // past TORSO_SWING_THRESHOLD=0.04
        } as LateralRaisePoseIntent;
      },
      buildLateralRaisePose,
      { fps: 30, durationMs: CAL_MS + 5000 },
    );

    const result = runLateralRaiseSession(frames);
    expect(countWarnings(result, 'torso-swing')).toBe(0);
  });

  it('does NOT fire torso-swing during RISING either (round 20 total disable)', () => {
    const repCycleMs = 3000;
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) {
          return { abductionDeg: 0 } as LateralRaisePoseIntent;
        }
        const tInRep = (tMs - CAL_MS) % repCycleMs;
        let abductionDeg: number;
        if (tInRep < 1000) abductionDeg = (tInRep / 1000) * 88;
        else if (tInRep < 1500) abductionDeg = 88;
        else if (tInRep < 2500) abductionDeg = 88 - ((tInRep - 1500) / 1000) * 88;
        else abductionDeg = 0;
        const inActive = abductionDeg > 30;
        return {
          abductionDeg,
          torsoSwayX: inActive ? 0.06 : 0,
        } as LateralRaisePoseIntent;
      },
      buildLateralRaisePose,
      { fps: 30, durationMs: CAL_MS + 2 * repCycleMs },
    );

    const result = runLateralRaiseSession(frames);
    expect(countWarnings(result, 'torso-swing')).toBe(0);
  });
});
