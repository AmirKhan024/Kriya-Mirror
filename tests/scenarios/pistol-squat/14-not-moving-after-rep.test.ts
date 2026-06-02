/**
 * Regression test for Fix O (EMA-decay reseed): idle `not-moving` warning
 * must fire after a real rep, not just from cold-start STANDING.
 *
 * Without Fix O, the post-rep EMA-decay tail (smoothedFlexion drifting from
 * ~17° to 0° over several seconds) permanently inflates max - min, so
 * variance never drops below 2° and not-moving never fires after a rep.
 *
 * Fix: once smoothedFlexion has settled (per-frame Δ < 0.3° for 500ms),
 * drop the cached min/max and reseed from the current value.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildPistolSquatPose } from '../../harness/pose-stub';
import { runPistolSquatSession, countWarnings } from '../../harness/runner';
import type { PistolSquatPoseIntent } from '../../harness/types';

const CAL_MS = 2200;

describe('Pistol Squat — regression: not-moving fires after a real rep + idle (Fix O)', () => {
  it('DOES fire not-moving when user rests in STANDING after completing a rep', () => {
    // Profile: stand-still during calibration → one full pistol rep
    // (0→90→0 over 2.9s) → 8s of STANDING idle.
    // Total = 2.2 + 2.9 + 8 = 13.1s
    const REP_END_MS = CAL_MS + 2900;
    const TOTAL_MS = REP_END_MS + 8000;
    const frames = buildFrames(
      (tMs): PistolSquatPoseIntent => {
        if (tMs < CAL_MS) {
          return { kneeFlexionDeg: 0, standingLeg: 'left', armsForward: false };
        }
        if (tMs < REP_END_MS) {
          const tInRep = tMs - CAL_MS;
          let kneeFlexionDeg: number;
          if (tInRep < 1200) kneeFlexionDeg = (tInRep / 1200) * 90;
          else if (tInRep < 1700) kneeFlexionDeg = 90;
          else kneeFlexionDeg = 90 - ((tInRep - 1700) / 1200) * 90;
          return { kneeFlexionDeg, standingLeg: 'left', armsForward: true };
        }
        // Post-rep idle: stand still.
        return { kneeFlexionDeg: 0, standingLeg: 'left', armsForward: false };
      },
      buildPistolSquatPose,
      { fps: 30, durationMs: TOTAL_MS },
    );

    const result = runPistolSquatSession(frames);

    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThan(500);
    // The whole point: idle warning must fire post-rep.
    expect(countWarnings(result, 'not-moving')).toBeGreaterThanOrEqual(1);
  });
});
