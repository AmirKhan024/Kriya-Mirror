/**
 * Regression test for round-7 Lunge fix: idle `not-moving` warning must fire
 * after a real rep, not just from cold-start STANDING. The bug from physical
 * testing: user did 2 reps, then idled for 17 seconds, no `not-moving` ever
 * fired. Root cause was the post-rep EMA-decay tail (smoothedFlexion drifting
 * from ~17° to 0° over several seconds) permanently inflating max - min, so
 * variance never closed back below the 2° gate.
 *
 * Fix (engine.ts): once smoothedFlexion has settled (per-frame Δ < 0.3° for
 * 500ms), drop the cached min/max and reseed from the current value, so the
 * variance accumulator reflects only true post-settle jitter.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildLungePose } from '../../harness/pose-stub';
import { runLungeSession, countWarnings } from '../../harness/runner';
import type { LungePoseIntent } from '../../harness/types';

const CAL_MS = 2200;

describe('Lunge — regression: not-moving fires after a real rep + idle (2026-05-25)', () => {
  it('DOES fire not-moving when user rests in STANDING after completing a rep', () => {
    // Profile: stand-still during calibration → one full lunge rep (0 → 90 → 0
    // over 2.5s) → 8s of STANDING idle. Total = 2.2 + 2.5 + 8 = 12.7s.
    const REP_END_MS = CAL_MS + 2500;
    const TOTAL_MS = REP_END_MS + 8000;
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) {
          return {
            kneeFlexionDeg: 0,
            frontLeg: 'left' as const,
            armsAtSides: true,
          } as LungePoseIntent;
        }
        if (tMs < REP_END_MS) {
          // Real rep: 0 → 90 over 1s, hold 90 for 0.5s, 90 → 0 over 1s.
          const tInRep = tMs - CAL_MS;
          let kneeFlexionDeg: number;
          if (tInRep < 1000) kneeFlexionDeg = (tInRep / 1000) * 90;
          else if (tInRep < 1500) kneeFlexionDeg = 90;
          else kneeFlexionDeg = 90 - ((tInRep - 1500) / 1000) * 90;
          return {
            kneeFlexionDeg,
            frontLeg: 'left' as const,
            armsAtSides: false,
          } as LungePoseIntent;
        }
        // Post-rep idle: stand still.
        return {
          kneeFlexionDeg: 0,
          frontLeg: 'left' as const,
          armsAtSides: true,
        } as LungePoseIntent;
      },
      buildLungePose,
      { fps: 30, durationMs: TOTAL_MS },
    );

    const result = runLungeSession(frames);

    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThan(500);
    // The whole point: idle warning must fire post-rep.
    expect(countWarnings(result, 'not-moving')).toBeGreaterThanOrEqual(1);
  });
});
