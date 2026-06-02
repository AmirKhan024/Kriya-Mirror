/**
 * Fix O — post-rep EMA-decay reseed. After a real rep, smoothedAbduction
 * decays exponentially from peak back to rest, inflating max - min so the
 * variance gate never closes. Without Fix O the second idle period never
 * fires `not-moving`.
 *
 * Fix (engine.ts): once smoothedAbduction has settled (per-frame Δ < 0.3°
 * for 500 ms), drop the cached min/max and reseed from the current value.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildLateralRaisePose } from '../../harness/pose-stub';
import { runLateralRaiseSession, countWarnings } from '../../harness/runner';
import type { LateralRaisePoseIntent } from '../../harness/types';

const CAL_MS = 2200;

describe('Lateral Raise — regression: not-moving fires after a real rep + idle', () => {
  it('DOES fire not-moving when user rests in DOWN after completing a rep', () => {
    // Profile: arms-at-sides during cal → one full raise (0 → 88 → 0 over
    // 2.5 s) → 8 s of DOWN idle. Total = 2.2 + 2.5 + 8 = 12.7 s.
    const REP_END_MS = CAL_MS + 2500;
    const TOTAL_MS = REP_END_MS + 8000;
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) {
          return { abductionDeg: 0 } as LateralRaisePoseIntent;
        }
        if (tMs < REP_END_MS) {
          const tInRep = tMs - CAL_MS;
          let abductionDeg: number;
          if (tInRep < 1000) abductionDeg = (tInRep / 1000) * 88;
          else if (tInRep < 1500) abductionDeg = 88;
          else abductionDeg = 88 - ((tInRep - 1500) / 1000) * 88;
          return { abductionDeg } as LateralRaisePoseIntent;
        }
        return { abductionDeg: 0 } as LateralRaisePoseIntent;
      },
      buildLateralRaisePose,
      { fps: 30, durationMs: TOTAL_MS },
    );

    const result = runLateralRaiseSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThan(500);
    expect(countWarnings(result, 'not-moving')).toBeGreaterThanOrEqual(1);
  });
});
