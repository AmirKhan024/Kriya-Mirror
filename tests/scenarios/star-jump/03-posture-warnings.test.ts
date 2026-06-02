/**
 * Star Jump — posture warnings.
 * - Good form (symmetric, legs spread, no torso swing) produces zero non-idle warnings.
 * - incomplete-star-jump fires on shallow reps (gated to non-DOWN state, Fix A).
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildStarJumpPose } from '../../harness/pose-stub';
import { runStarJumpSession, countWarnings, warningsOtherThan } from '../../harness/runner';

const CAL_MS = 300;
const REP_CYCLE_MS = 2500;

describe('Star Jump — posture warnings', () => {
  it('clean full reps produce zero posture warnings (excluding not-moving)', () => {
    // Perfect reps: arms raise to 170° (fully overhead), legs spread wide, no torso swing.
    const REPS = 4;
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) return { armRaiseDeg: 0, feetSpreadRatio: 1.0 };
        const tInRep = (tMs - CAL_MS) % REP_CYCLE_MS;
        let armRaiseDeg: number;
        let feetSpreadRatio: number;
        if (tInRep < 800) {
          armRaiseDeg = (tInRep / 800) * 170;
          feetSpreadRatio = 1.0 + (tInRep / 800) * 0.5;
        } else if (tInRep < 1200) {
          armRaiseDeg = 170;
          feetSpreadRatio = 1.5;
        } else if (tInRep < 2000) {
          armRaiseDeg = 170 - ((tInRep - 1200) / 800) * 170;
          feetSpreadRatio = 1.5 - ((tInRep - 1200) / 800) * 0.5;
        } else {
          armRaiseDeg = 0;
          feetSpreadRatio = 1.0;
        }
        return { armRaiseDeg, feetSpreadRatio };
      },
      buildStarJumpPose,
      { fps: 30, durationMs: CAL_MS + REPS * REP_CYCLE_MS + 200 },
    );

    const result = runStarJumpSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.completedReps.length).toBe(REPS);
    expect(warningsOtherThan(result, 'not-moving').length).toBe(0);
  });

  it('incomplete-star-jump fires for shallow reps (Fix A: gated to non-DOWN state)', () => {
    // Arms reach 115° — enters AT_TOP but peak ≈ 0.110 < MIN_REP_PEAK_DELTA(0.12).
    // The warning fires when the rep is discarded as too-shallow, not during the down-rest phase.
    const REP_CYCLE_SHALLOW = 3300;
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) return { armRaiseDeg: 0 };
        const tInRep = (tMs - CAL_MS) % REP_CYCLE_SHALLOW;
        let armRaiseDeg: number;
        if (tInRep < 400)       armRaiseDeg = (tInRep / 400) * 115;
        else if (tInRep < 2400) armRaiseDeg = 115;
        else if (tInRep < 2800) armRaiseDeg = 115 - ((tInRep - 2400) / 400) * 115;
        else                    armRaiseDeg = 0;
        return { armRaiseDeg };
      },
      buildStarJumpPose,
      { fps: 30, durationMs: CAL_MS + REP_CYCLE_SHALLOW * 2 },
    );

    const result = runStarJumpSession(frames);
    // 0 counted reps, at least 1 incomplete-star-jump warning
    expect(result.completedReps.length).toBe(0);
    expect(countWarnings(result, 'incomplete-star-jump')).toBeGreaterThan(0);
    // No malformed-rep (this is shallow, not asymmetric)
    expect(countWarnings(result, 'malformed-rep')).toBe(0);
  });
});
