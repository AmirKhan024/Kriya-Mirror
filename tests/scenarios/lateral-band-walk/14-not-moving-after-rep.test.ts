/**
 * Lateral Band Walk — not-moving fires after a real step + idle (Fix O).
 *
 * Bug scenario: user does 1 step, EMA-smoothed hipX decays slowly back toward
 * baseline after the step. This decay tail inflates max - min, so variance
 * never drops below NO_MOVEMENT_VARIANCE, and not-moving never fires.
 *
 * Fix (Fix O): once |smoothedHipX - prevSmoothedHipX| < 0.003 for 500ms,
 * reseed hipXMin/hipXMax from the current value so the variance only reflects
 * true post-settle jitter.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildLateralBandWalkPose } from '../../harness/pose-stub';
import { runLateralBandWalkSession, countWarnings } from '../../harness/runner';
import type { LateralBandWalkPoseIntent } from '../../harness/types';

const CAL_MS = 300;

describe('Lateral Band Walk — not-moving fires after a real step + idle (Fix O)', () => {
  it('DOES fire not-moving when user rests after completing 1 step', () => {
    // Profile: calibrate → 1 clean step (1500ms) → 8s idle.
    // Total ≈ 300 + 1500 + 8000 = 9800ms.
    const STEP_END_MS = CAL_MS + 1500;
    const TOTAL_MS = STEP_END_MS + 8000;

    const frames = buildFrames(
      (tMs): LateralBandWalkPoseIntent => {
        if (tMs < CAL_MS) return { hipXDisplacement: 0 };
        const t = tMs - CAL_MS;
        // Displacement raised to 0.18 to exceed new STEP_CONFIRM_THRESHOLD=0.15
        if (t < 700) {
          return { hipXDisplacement: (t / 700) * 0.18, stepDirection: 'right' };
        }
        if (t < 1100) {
          return { hipXDisplacement: 0.18, stepDirection: 'right' };
        }
        if (t < 1500) {
          return {
            hipXDisplacement: 0.18 - ((t - 1100) / 400) * 0.18,
            stepDirection: 'right',
          };
        }
        // Post-step idle: stand still
        return { hipXDisplacement: 0 };
      },
      buildLateralBandWalkPose,
      { fps: 30, durationMs: TOTAL_MS },
    );

    const result = runLateralBandWalkSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThan(500);
    // The key: not-moving must fire post-step
    expect(countWarnings(result, 'not-moving')).toBeGreaterThanOrEqual(1);
  });

  it('does NOT fire not-moving within 4s of idle post-step', () => {
    // Step ends at ~1800ms, then 4s idle (total ~5800ms). 4s < 5s threshold.
    const STEP_END_MS = CAL_MS + 1500;
    const TOTAL_MS = STEP_END_MS + 4000;

    const frames = buildFrames(
      (tMs): LateralBandWalkPoseIntent => {
        if (tMs < CAL_MS) return { hipXDisplacement: 0 };
        const t = tMs - CAL_MS;
        if (t < 1500) {
          const disp = t < 750 ? (t / 750) * 0.06 : 0.06 - ((t - 750) / 750) * 0.06;
          return { hipXDisplacement: disp, stepDirection: 'right' };
        }
        return { hipXDisplacement: 0 };
      },
      buildLateralBandWalkPose,
      { fps: 30, durationMs: TOTAL_MS },
    );

    const result = runLateralBandWalkSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'not-moving')).toBe(0);
  });
});
