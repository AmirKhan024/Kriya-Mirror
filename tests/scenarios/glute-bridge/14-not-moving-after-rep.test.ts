/**
 * Regression test for Fix O on Glute Bridge: idle not-moving warning must fire
 * after a real rep, not just from cold-start RESTING.
 *
 * Root cause (without fix): the EMA-decay tail after a rep (smoothedRiseY
 * slowly decaying from peak back to 0) permanently inflates max - min, so the
 * variance never closes back below the gate. Fix O (EMA-decay reseed): once
 * per-frame delta < 0.001 for 500ms, reseed min/max from current value so
 * accumulated variance reflects only post-settle jitter.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildGluteBridgePose } from '../../harness/pose-stub';
import { runGluteBridgeSession, countWarnings } from '../../harness/runner';
import type { GluteBridgePoseIntent } from '../../harness/types';

const CAL_MS = 400;

describe('Glute Bridge — regression: not-moving fires after a real rep + idle', () => {
  it('DOES fire not-moving when user rests flat after completing a rep', () => {
    // Profile: calibrate (400ms) → one full rep (0→1→0 over 2s) → 8s idle flat.
    const REP_END_MS = CAL_MS + 2000;
    const TOTAL_MS = REP_END_MS + 8000;

    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) return { hipRise: 0 } as GluteBridgePoseIntent;
        if (tMs < REP_END_MS) {
          const tInRep = tMs - CAL_MS;
          let hipRise: number;
          if (tInRep < 800) hipRise = tInRep / 800;
          else if (tInRep < 1200) hipRise = 1.0;
          else hipRise = 1.0 - ((tInRep - 1200) / 800);
          return { hipRise: Math.max(0, hipRise) } as GluteBridgePoseIntent;
        }
        // Post-rep idle: lie still.
        return { hipRise: 0 } as GluteBridgePoseIntent;
      },
      buildGluteBridgePose,
      { fps: 30, durationMs: TOTAL_MS },
    );

    const result = runGluteBridgeSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThan(500);
    expect(countWarnings(result, 'not-moving')).toBeGreaterThanOrEqual(1);
  });
});
