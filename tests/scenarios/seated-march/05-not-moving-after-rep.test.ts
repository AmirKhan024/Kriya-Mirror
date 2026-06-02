/**
 * Fix O: after a rep returns to BOTH_DOWN, the per-side EMA-smoothed lift decays
 * from its peak toward rest. The decay tail must not keep the idle-variance gate
 * open forever — once both sides settle, the gate reseeds and a genuine idle
 * stretch fires `not-moving`.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildSeatedMarchPose } from '../../harness/pose-stub';
import { runSeatedMarchSession, countWarnings } from '../../harness/runner';
import type { SeatedMarchPoseIntent } from '../../harness/types';

const CAL_MS = 1000;
const CYCLE_MS = 1600; // one cycle = 2 reps (one L, one R)

describe('Seated March — not-moving after a rep (Fix O)', () => {
  it('fires not-moving once the user goes idle after marching', () => {
    const frames = buildFrames(
      (tMs): SeatedMarchPoseIntent => {
        if (tMs < CAL_MS) return { leftKneeLiftPct: 0, rightKneeLiftPct: 0 };
        const t = tMs - CAL_MS;
        if (t < CYCLE_MS) {
          // one alternating cycle, then idle
          if (t < 400) return { leftKneeLiftPct: (t / 400) * 50, rightKneeLiftPct: 0 };
          if (t < 800) return { leftKneeLiftPct: 50, rightKneeLiftPct: 0 };
          if (t < 1200) { const u = (t - 800) / 400; return { leftKneeLiftPct: 50 * (1 - u), rightKneeLiftPct: 50 * u }; }
          return { leftKneeLiftPct: 0, rightKneeLiftPct: 50 * (1 - (t - 1200) / 400) };
        }
        return { leftKneeLiftPct: 0, rightKneeLiftPct: 0 }; // idle
      },
      buildSeatedMarchPose,
      { fps: 30, durationMs: CAL_MS + CYCLE_MS + 6500 },
    );
    const result = runSeatedMarchSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.completedReps.length).toBeGreaterThanOrEqual(2);
    expect(countWarnings(result, 'not-moving')).toBeGreaterThan(0);
  });
});
