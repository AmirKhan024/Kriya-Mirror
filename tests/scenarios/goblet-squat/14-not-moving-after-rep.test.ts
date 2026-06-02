/**
 * Regression test for Fix O — post-rep EMA-decay reseed.
 *
 * Symptom: after a real rep, smoothedFlexion decays from ~18° → 0° over several
 * seconds. This permanently inflates max - min so variance never drops below 2°
 * and 'not-moving' never fires after the user does a rep and then rests.
 *
 * Fix: once smoothedFlexion has settled (per-frame Δ < 0.3° for 500ms), reseed
 * min/max from the current value.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildGobletSquatPose } from '../../harness/pose-stub';
import { runGobletSquatSession, countWarnings } from '../../harness/runner';
import type { GobletSquatPoseIntent } from '../../harness/types';

const CAL_MS = 2200;

function standingIntent(): GobletSquatPoseIntent {
  return { kneeFlexionDeg: 0, feetWidthRatio: 1.25, elbowSpreadRatio: 1.0, bodyHeight: 0.70 };
}

describe('Goblet Squat — regression: not-moving fires after a real rep + idle (Fix O)', () => {
  it('DOES fire not-moving when user rests in STANDING after completing a rep', () => {
    // Profile: calibrate → one full goblet squat rep → 8s of STANDING idle.
    // Total = 2.2 + 2.5 + 8 = 12.7s.
    const REP_END_MS = CAL_MS + 2500;
    const TOTAL_MS = REP_END_MS + 8000;
    const frames = buildFrames(
      (tMs): GobletSquatPoseIntent => {
        if (tMs < CAL_MS) return standingIntent();
        if (tMs < REP_END_MS) {
          const tInRep = tMs - CAL_MS;
          let kneeFlexionDeg: number;
          if (tInRep < 1000) kneeFlexionDeg = (tInRep / 1000) * 100;
          else if (tInRep < 1500) kneeFlexionDeg = 100;
          else kneeFlexionDeg = 100 - ((tInRep - 1500) / 1000) * 100;
          return { ...standingIntent(), kneeFlexionDeg };
        }
        return standingIntent();
      },
      buildGobletSquatPose,
      { fps: 30, durationMs: TOTAL_MS },
    );

    const result = runGobletSquatSession(frames);

    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThan(500);
    // The whole point: idle warning must fire post-rep (Fix O).
    expect(countWarnings(result, 'not-moving')).toBeGreaterThanOrEqual(1);
  });
});
