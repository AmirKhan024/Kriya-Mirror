/**
 * Regression test for round-7 Bicep Curl fix: idle `not-moving` warning must
 * fire after a real rep, not just from cold-start EXTENDED. Same bug pattern
 * as lunge round-7 — the post-rep EMA-decay tail (smoothedFlexion drifting
 * from ~17° down to resting ~10° over several seconds) permanently inflates
 * max - min, so variance never closes back below the 2° gate.
 *
 * Fix (engine.ts): once smoothedFlexion has settled (per-frame Δ < 0.3° for
 * 500ms), drop the cached min/max and reseed from the current value, so the
 * variance accumulator reflects only true post-settle jitter.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildBicepCurlPose } from '../../harness/pose-stub';
import { runBicepCurlSession, countWarnings } from '../../harness/runner';
import type { BicepCurlPoseIntent } from '../../harness/types';

const CAL_MS = 2200;

describe('Bicep Curl — regression: not-moving fires after a real rep + idle (2026-05-25)', () => {
  it('DOES fire not-moving when user rests in EXTENDED after completing a rep', () => {
    // Profile: arms-at-sides during calibration → one full curl (0 → 130 → 0
    // over 2.5s) → 8s of EXTENDED idle. Total = 2.2 + 2.5 + 8 = 12.7s.
    const REP_END_MS = CAL_MS + 2500;
    const TOTAL_MS = REP_END_MS + 8000;
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) {
          return { elbowFlexionDeg: 0 } as BicepCurlPoseIntent;
        }
        if (tMs < REP_END_MS) {
          // Real curl: 0 → 130 over 1s, hold 130 for 0.5s, 130 → 0 over 1s.
          const tInRep = tMs - CAL_MS;
          let elbowFlexionDeg: number;
          if (tInRep < 1000) elbowFlexionDeg = (tInRep / 1000) * 130;
          else if (tInRep < 1500) elbowFlexionDeg = 130;
          else elbowFlexionDeg = 130 - ((tInRep - 1500) / 1000) * 130;
          return { elbowFlexionDeg } as BicepCurlPoseIntent;
        }
        // Post-rep idle: arms hanging at sides.
        return { elbowFlexionDeg: 0 } as BicepCurlPoseIntent;
      },
      buildBicepCurlPose,
      { fps: 30, durationMs: TOTAL_MS },
    );

    const result = runBicepCurlSession(frames);

    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThan(500);
    expect(countWarnings(result, 'not-moving')).toBeGreaterThanOrEqual(1);
  });
});
