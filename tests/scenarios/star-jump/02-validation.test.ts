/**
 * Star Jump — rep validation.
 *
 * - Shallow raise (arms only reach 115°) → enters AT_TOP (smoothed delta crosses 0.08),
 *   but peakWristDelta ≈ 0.110 < MIN_REP_PEAK_DELTA(0.12) → incomplete-star-jump, 0 reps.
 *
 * - Asymmetric arms (left 170°, right 115°) → average delta enters AT_TOP; bilateral check:
 *   lo/hi = 0.110/0.256 = 0.43 < MIN_BILATERAL_SYMMETRY(0.60) → malformed-rep.
 *
 * Geometry (SJ_ARM_L_TOTAL=0.26):
 *   wristDelta per arm = shoulderY - wristY = -(0.26 × cos(raiseDeg))
 *   115°: wristDelta = -(0.26 × cos(115°)) = -(0.26 × -0.423) ≈ +0.110   (overhead, < 0.12)
 *   170°: wristDelta = -(0.26 × cos(170°)) = -(0.26 × -0.985) ≈ +0.256   (fully overhead)
 *   avg (170+115): (0.256 + 0.110)/2 = 0.183 > AT_TOP_THRESHOLD(0.08) → enters AT_TOP
 *
 * Note: AT_TOP_THRESHOLD=0.08 and MIN_REP_PEAK_DELTA=0.12 — incomplete fires when
 * arms enter AT_TOP but peak < 0.12 (arms cleared shoulder but not truly overhead).
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildStarJumpPose } from '../../harness/pose-stub';
import { runStarJumpSession, countWarnings } from '../../harness/runner';

const CAL_MS = 300;
// Cycle: 400ms rise, 2000ms hold (EMA converges to ~target), 400ms lower, 500ms rest.
const REP_CYCLE_MS = 3300;

describe('Star Jump — rep validation', () => {
  it('shallow raise (115 deg peak) produces incomplete-star-jump warning and 0 counted reps', () => {
    // Arms reach 115°. wristDelta peak ≈ 0.110 > AT_TOP_THRESHOLD(0.08) so state enters AT_TOP,
    // but 0.110 < MIN_REP_PEAK_DELTA(0.12) → too-shallow → incomplete-star-jump fires, rep discarded.
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) return { armRaiseDeg: 0 };
        const tInRep = (tMs - CAL_MS) % REP_CYCLE_MS;
        let armRaiseDeg: number;
        if (tInRep < 400)       armRaiseDeg = (tInRep / 400) * 115;
        else if (tInRep < 2400) armRaiseDeg = 115;
        else if (tInRep < 2800) armRaiseDeg = 115 - ((tInRep - 2400) / 400) * 115;
        else                    armRaiseDeg = 0;
        return { armRaiseDeg };
      },
      buildStarJumpPose,
      { fps: 30, durationMs: CAL_MS + REP_CYCLE_MS * 2 },
    );

    const result = runStarJumpSession(frames);
    expect(result.completedReps.length).toBe(0);
    expect(countWarnings(result, 'incomplete-star-jump')).toBeGreaterThan(0);
  });

  it('asymmetric raise (left 170 deg, right 115 deg) produces malformed-rep and 0 counted reps', () => {
    // Left: 170° → peakDeltaLeft ≈ 0.256 (fully overhead)
    // Right: 115° → peakDeltaRight ≈ 0.110 (partially overhead)
    // Average = 0.183 > AT_TOP_THRESHOLD(0.08) → enters AT_TOP.
    // peakSum = 0.366 > 0. lo/hi = 0.110/0.256 = 0.43 < MIN_BILATERAL_SYMMETRY(0.60) → malformed-rep.
    // Note: peakWristDelta (average) ≈ 0.183 > MIN_REP_PEAK_DELTA(0.12) → bilateral check fires first (Fix D).
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) return { armRaiseDeg: 0 };
        const tInRep = (tMs - CAL_MS) % REP_CYCLE_MS;
        let leftArmRaiseDeg: number;
        let rightArmRaiseDeg: number;
        if (tInRep < 400) {
          leftArmRaiseDeg  = (tInRep / 400) * 170;
          rightArmRaiseDeg = (tInRep / 400) * 115;
        } else if (tInRep < 2400) {
          leftArmRaiseDeg = 170; rightArmRaiseDeg = 115;
        } else if (tInRep < 2800) {
          leftArmRaiseDeg  = 170 - ((tInRep - 2400) / 400) * 170;
          rightArmRaiseDeg = 115 - ((tInRep - 2400) / 400) * 115;
        } else {
          leftArmRaiseDeg = 0; rightArmRaiseDeg = 0;
        }
        return { armRaiseDeg: 0, leftArmRaiseDeg, rightArmRaiseDeg };
      },
      buildStarJumpPose,
      { fps: 30, durationMs: CAL_MS + REP_CYCLE_MS * 2 },
    );

    const result = runStarJumpSession(frames);
    expect(result.completedReps.length).toBe(0);
    expect(countWarnings(result, 'malformed-rep')).toBeGreaterThan(0);
  });
});
