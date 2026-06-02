/**
 * Regression test for Fix O: idle 'not-moving' warning must fire after a real
 * rep, not just from cold-start STANDING.
 *
 * Bug scenario: user does 1 rep, then idles for 8s, but 'not-moving' never
 * fires. Root cause: post-rep EMA-decay tail (smoothedKneeAngle drifting from
 * ~155° back toward ~170° over several seconds) permanently inflates max-min,
 * so variance never closes back below the 2° gate.
 *
 * Fix (engine.ts): once smoothedKneeAngle has settled (per-frame Δ < 0.3° for
 * 500ms), re-baseline min/max from current value. Idle counting starts fresh.
 *
 * Mirrors tests/scenarios/lunge/14-not-moving-after-rep.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildCurtsyLungePose } from '../../harness/pose-stub';
import { runCurtsyLungeSession, countWarnings } from '../../harness/runner';
import type { CurtsyLungePoseIntent } from '../../harness/types';

const CAL_MS = 2200;

describe('Curtsy Lunge — regression: not-moving fires after a real rep + idle (Fix O)', () => {
  it('DOES fire not-moving when user rests in STANDING after completing a rep', () => {
    // Profile:
    //   0 – 2.2s   : calibration (still standing)
    //   2.2 – 4.7s : one full curtsy rep (descent + hold + ascent, total 2.5s)
    //   4.7 – 12.7s: idle STANDING for 8s
    // Total = 12.7s. Fix O must re-baseline the EMA after the rep so that
    // the 5s idle timer triggers 'not-moving' around t=9.7s.
    const REP_END_MS = CAL_MS + 2500;
    const TOTAL_MS = REP_END_MS + 8000;

    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) {
          return {
            kneeFlexionDeg: 170,
            crossoverRatio: 0,
          } as CurtsyLungePoseIntent;
        }
        if (tMs < REP_END_MS) {
          // One rep: 170→90 over 1s, hold 0.5s, 90→170 over 1s
          const tInRep = tMs - CAL_MS;
          let kneeFlexionDeg: number;
          if (tInRep < 1000) kneeFlexionDeg = 170 - (tInRep / 1000) * 80;
          else if (tInRep < 1500) kneeFlexionDeg = 90;
          else kneeFlexionDeg = 90 + ((tInRep - 1500) / 1000) * 80;
          return {
            kneeFlexionDeg,
            crossoverRatio: 0.12,
          } as CurtsyLungePoseIntent;
        }
        // Post-rep idle: stand still
        return {
          kneeFlexionDeg: 170,
          crossoverRatio: 0,
        } as CurtsyLungePoseIntent;
      },
      buildCurtsyLungePose,
      { fps: 30, durationMs: TOTAL_MS },
    );

    const result = runCurtsyLungeSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThan(500);
    // The whole point: idle warning must fire post-rep
    expect(countWarnings(result, 'not-moving')).toBeGreaterThanOrEqual(1);
  });
});
