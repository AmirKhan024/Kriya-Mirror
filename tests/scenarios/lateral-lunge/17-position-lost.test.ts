/**
 * Fix N — position-lost detection. If no usable pose frame for ≥ 3 s
 * post-calibration, the engine emits `position-lost`. Repeats every 10 s.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildLateralLungePose } from '../../harness/pose-stub';
import { runLateralLungeSession, countWarnings } from '../../harness/runner';
import type { LateralLungePoseIntent } from '../../harness/types';

const CAL_MS = 2200;

describe('Lateral Lunge — position-lost warning (Fix N)', () => {
  it('fires position-lost after 3+ seconds of null landmarks post-calibration', () => {
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) return { workingKneeFlexionDeg: 0, workingSide: 'left', lateralShift: 0, armsAtSides: true } as LateralLungePoseIntent;
        return null;
      },
      buildLateralLungePose,
      { fps: 30, durationMs: CAL_MS + 4000 },
    );
    const result = runLateralLungeSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'position-lost')).toBeGreaterThan(0);
  });

  it('does NOT fire position-lost on a clean continuous stream', () => {
    const frames = buildFrames(
      () => ({ workingKneeFlexionDeg: 0, workingSide: 'left', lateralShift: 0, armsAtSides: true } as LateralLungePoseIntent),
      buildLateralLungePose,
      { fps: 30, durationMs: 4000 },
    );
    const result = runLateralLungeSession(frames);
    expect(countWarnings(result, 'position-lost')).toBe(0);
  });

  it('does NOT re-fire position-lost within the 10s cooldown', () => {
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) return { workingKneeFlexionDeg: 0, workingSide: 'left', lateralShift: 0, armsAtSides: true } as LateralLungePoseIntent;
        return null;
      },
      buildLateralLungePose,
      { fps: 30, durationMs: CAL_MS + 5000 },
    );
    const result = runLateralLungeSession(frames);
    expect(countWarnings(result, 'position-lost')).toBe(1);
  });
});
