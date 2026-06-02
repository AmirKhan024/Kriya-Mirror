/**
 * Reverse Fly — posture warnings.
 * Asymmetry: one arm at 80° other at 30° → bilateral ratio < 0.60 → malformed-rep at rep close.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildReverseFlyPose } from '../../harness/pose-stub';
import { runReverseFlySession, countWarnings } from '../../harness/runner';

const CAL_MS = 300;

describe('Reverse Fly — posture warnings', () => {
  it('extreme bilateral asymmetry (one arm 65°, other 20°) → malformed-rep fires, rep rejected', () => {
    // Left arm raises to 65°, right arm only to 20° → ratio ≈ 0.28 < 0.60
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) return { armLiftDeg: 0, bentOver: true };
        const tRep = tMs - CAL_MS;
        let leftLift: number;
        let rightLift: number;
        // Left arm raises fully, right arm barely raises
        if (tRep < 1000) {
          leftLift  = (tRep / 1000) * 65;
          rightLift = (tRep / 1000) * 20;
        } else if (tRep < 1500) {
          leftLift  = 65;
          rightLift = 20;
        } else if (tRep < 2500) {
          leftLift  = 65 - ((tRep - 1500) / 1000) * 65;
          rightLift = 20 - ((tRep - 1500) / 1000) * 20;
        } else {
          leftLift  = 0;
          rightLift = 0;
        }
        return { armLiftDeg: 0, leftArmLiftDeg: leftLift, rightArmLiftDeg: rightLift, bentOver: true };
      },
      buildReverseFlyPose,
      { fps: 30, durationMs: CAL_MS + 4000 },
    );

    const result = runReverseFlySession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    // Rep should be rejected due to bilateral asymmetry
    expect(result.completedReps.length).toBe(0);
    // A rep-rejection warning fires (malformed-rep or incomplete)
    const rejectionWarnings = countWarnings(result, 'malformed-rep')
      + countWarnings(result, 'incomplete-reverse-fly' as never);
    expect(rejectionWarnings).toBeGreaterThan(0);
  });

  it('symmetric fly (both arms within 0.60 ratio) IS counted', () => {
    // Both arms raise to 65° symmetrically
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) return { armLiftDeg: 0, bentOver: true };
        const tRep = tMs - CAL_MS;
        let liftDeg: number;
        if (tRep < 1000)      liftDeg = (tRep / 1000) * 65;
        else if (tRep < 1500) liftDeg = 65;
        else if (tRep < 2500) liftDeg = 65 - ((tRep - 1500) / 1000) * 65;
        else                  liftDeg = 0;
        return { armLiftDeg: liftDeg, bentOver: true };
      },
      buildReverseFlyPose,
      { fps: 30, durationMs: CAL_MS + 3500 },
    );

    const result = runReverseFlySession(frames);
    expect(result.completedReps.length).toBe(1);
  });

  it('mild asymmetry (72° vs 60° — ratio 0.90) passes symmetry check and counts as a rep', () => {
    // ratio = min(72, 60) / avg(72, 60) = 60/66 ≈ 0.91 > 0.60 → valid rep
    // avg = 66° which exceeds AT_TOP_THRESHOLD=60°, so rep goes through full state machine
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) return { armLiftDeg: 0, bentOver: true };
        const tRep = tMs - CAL_MS;
        let leftLift: number;
        let rightLift: number;
        if (tRep < 1000) {
          leftLift  = (tRep / 1000) * 72;
          rightLift = (tRep / 1000) * 60;
        } else if (tRep < 1500) {
          leftLift  = 72;
          rightLift = 60;
        } else if (tRep < 2500) {
          leftLift  = 72 - ((tRep - 1500) / 1000) * 72;
          rightLift = 60 - ((tRep - 1500) / 1000) * 60;
        } else {
          leftLift  = 0;
          rightLift = 0;
        }
        return { armLiftDeg: 0, leftArmLiftDeg: leftLift, rightArmLiftDeg: rightLift, bentOver: true };
      },
      buildReverseFlyPose,
      { fps: 30, durationMs: CAL_MS + 3500 },
    );

    const result = runReverseFlySession(frames);
    expect(result.completedReps.length).toBe(1);
  });
});
