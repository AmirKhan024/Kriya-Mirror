/**
 * Regression test for Fix O on Arm Circles (round 21 re-architected to
 * 4-state machine). After a real rep completes, the EMA-decay tail keeps
 * the smoothed-abduction min/max spread inflated, so the variance gate
 * never closes. Fix O reseeds the DOWN baseline once smoothing has settled
 * for 500 ms.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildArmCirclesPose } from '../../harness/pose-stub';
import { runArmCirclesSession, countWarnings } from '../../harness/runner';
import type { ArmCirclesPoseIntent } from '../../harness/types';

const CAL_MS = 2200;

describe('Arm Circles — regression: not-moving fires after a real rep + idle', () => {
  it('DOES fire not-moving when user rests in DOWN after a real rep', () => {
    // Profile: cal → one full sweep (0 → 165 → 0 over 3s) → 8s idle.
    const REP_END_MS = CAL_MS + 3000;
    const TOTAL_MS = REP_END_MS + 8000;
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) return { abductionDeg: 0 } as ArmCirclesPoseIntent;
        if (tMs < REP_END_MS) {
          const t = tMs - CAL_MS;
          let abd: number;
          if (t < 900) abd = (t / 900) * 165;
          else if (t < 1500) abd = 165;
          else abd = Math.max(0, 165 - ((t - 1500) / 1500) * 165);
          return { abductionDeg: abd } as ArmCirclesPoseIntent;
        }
        return { abductionDeg: 0 } as ArmCirclesPoseIntent;
      },
      buildArmCirclesPose,
      { fps: 30, durationMs: TOTAL_MS },
    );

    const result = runArmCirclesSession(frames);

    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'not-moving')).toBeGreaterThanOrEqual(1);
  });
});
