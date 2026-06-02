/**
 * Rep validation: incomplete depth fires 'incomplete-goblet-squat'.
 * Too-fast rep fires 'malformed-rep'.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildGobletSquatPose } from '../../harness/pose-stub';
import { runGobletSquatSession, countWarnings } from '../../harness/runner';
import type { GobletSquatPoseIntent } from '../../harness/types';

const CAL_MS = 2200;

function calIntent(): GobletSquatPoseIntent {
  return { kneeFlexionDeg: 0, feetWidthRatio: 1.25, elbowSpreadRatio: 1.0, bodyHeight: 0.70 };
}

describe('Goblet Squat — rep validation', () => {
  it('fires incomplete-goblet-squat when depth is not reached (peak flexion < 45°)', () => {
    // User only goes to 30° — not enough depth
    const TOTAL_MS = CAL_MS + 3000;
    const REP_END_MS = CAL_MS + 2000;
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) return calIntent();
        if (tMs < CAL_MS + 600) {
          // Descend to 30° (below DESCEND_START=25° but never reaches MIN_REP_DEPTH=45°)
          const t = tMs - CAL_MS;
          return { ...calIntent(), kneeFlexionDeg: (t / 600) * 30 };
        }
        if (tMs < CAL_MS + 900) {
          // Hold at 30°
          return { ...calIntent(), kneeFlexionDeg: 30 };
        }
        if (tMs < REP_END_MS) {
          // Ascend back to 0°
          const t = tMs - (CAL_MS + 900);
          return { ...calIntent(), kneeFlexionDeg: 30 - (t / 1100) * 30 };
        }
        return calIntent();
      },
      buildGobletSquatPose,
      { fps: 30, durationMs: TOTAL_MS },
    );

    const result = runGobletSquatSession(frames);

    expect(result.finalCalibration?.state).toBe('confirmed');
    // Rep should be discarded (depth not reached)
    expect(result.completedReps.length).toBe(0);
    // incomplete-goblet-squat should fire
    expect(countWarnings(result, 'incomplete-goblet-squat' as any)).toBeGreaterThan(0);
  });

  it('fires malformed-rep for a too-fast rep (< 300ms)', () => {
    // Rep completes in ~150ms — below MIN_REP_DURATION_MS
    const TOTAL_MS = CAL_MS + 3000;
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) return calIntent();
        const t = tMs - CAL_MS;
        if (t < 50) return { ...calIntent(), kneeFlexionDeg: (t / 50) * 100 };
        if (t < 100) return { ...calIntent(), kneeFlexionDeg: 100 };
        if (t < 150) return { ...calIntent(), kneeFlexionDeg: 100 - ((t - 100) / 50) * 100 };
        return calIntent();
      },
      buildGobletSquatPose,
      { fps: 30, durationMs: TOTAL_MS },
    );

    const result = runGobletSquatSession(frames);

    expect(result.finalCalibration?.state).toBe('confirmed');
    // Rep should be discarded
    expect(result.completedReps.length).toBe(0);
    expect(countWarnings(result, 'malformed-rep')).toBeGreaterThan(0);
  });
});
