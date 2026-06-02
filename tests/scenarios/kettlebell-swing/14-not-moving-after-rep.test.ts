/**
 * Kettlebell Swing — not-moving fires after rep + idle (Fix O regression).
 * After a rep, EMA decays slowly. Fix O reseeds min/max once settled so
 * variance closes below 2° and the not-moving warning can fire.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildKBSwingPose } from '../../harness/pose-stub';
import { runKBSwingSession, countWarnings } from '../../harness/runner';
import type { KBSwingPoseIntent } from '../../harness/types';

const CAL_MS = 1000;

describe('Kettlebell Swing — regression: not-moving fires after a real rep + idle', () => {
  it('DOES fire not-moving when user rests in STANDING after completing a rep', () => {
    // Profile: calibrate 1s → one full swing rep (0→65→0 over 2.4s) → 8s STANDING idle.
    const REP_END_MS = CAL_MS + 2400;
    const TOTAL_MS = REP_END_MS + 8000;

    const frames = buildFrames(
      (tMs): KBSwingPoseIntent => {
        if (tMs < CAL_MS) return { hipHingeDeg: 0 };
        if (tMs < REP_END_MS) {
          const tInRep = tMs - CAL_MS;
          let hinge: number;
          if (tInRep < 800) hinge = (tInRep / 800) * 65;
          else if (tInRep < 1200) hinge = 65;
          else hinge = Math.max(0, 65 - ((tInRep - 1200) / 1200) * 65);
          return { hipHingeDeg: hinge };
        }
        // Post-rep idle
        return { hipHingeDeg: 0 };
      },
      buildKBSwingPose,
      { fps: 30, durationMs: TOTAL_MS },
    );

    const result = runKBSwingSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    // The main regression: not-moving must fire after a real rep + idle
    expect(countWarnings(result, 'not-moving')).toBeGreaterThanOrEqual(1);
  });
});
