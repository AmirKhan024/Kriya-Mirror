import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildSingleLegStandPose } from '../../harness/pose-stub';
import { runSingleLegStandSession, countWarnings } from '../../harness/runner';

const CAL_MS = 2200;

describe('Single Leg Stand — hip tilt detection', () => {
  it('fires hip-tilted warning when lifted-side hip drops persistently', () => {
    // hipDrop of 0.030 = ~0.19 shoulder widths → past 0.15 threshold
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) return { liftedSide: 'left' as const };
        const tAfter = tMs - CAL_MS;
        const hipDrop = tAfter >= 1500 && tAfter < 3500 ? 0.030 : 0;
        return { liftedSide: 'left' as const, hipDrop };
      },
      buildSingleLegStandPose,
      { fps: 30, durationMs: CAL_MS + 5000 },
    );
    const result = runSingleLegStandSession(frames);
    expect(countWarnings(result, 'hip-tilted')).toBeGreaterThan(0);
  });

  it('does NOT fire hip-tilted for momentary drop (4 frames)', () => {
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) return { liftedSide: 'left' as const };
        const tAfter = tMs - CAL_MS;
        const hipDrop = tAfter >= 2000 && tAfter < 2120 ? 0.030 : 0;
        return { liftedSide: 'left' as const, hipDrop };
      },
      buildSingleLegStandPose,
      { fps: 30, durationMs: CAL_MS + 5000 },
    );
    const result = runSingleLegStandSession(frames);
    expect(countWarnings(result, 'hip-tilted')).toBe(0);
  });

  it('does NOT fire on a clean still hold (no hip drop)', () => {
    const frames = buildFrames(
      () => ({ liftedSide: 'left' as const }),
      buildSingleLegStandPose,
      { fps: 30, durationMs: CAL_MS + 8000 },
    );
    const result = runSingleLegStandSession(frames);
    expect(countWarnings(result, 'hip-tilted')).toBe(0);
  });
});
