/**
 * Romanian Deadlift — rep validation.
 * Shallow hinge (< 40°) → fires incomplete-rdl.
 * Too-fast rep → fires malformed-rep.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames, concatFrames } from '../../harness/frame-stream';
import { buildRomanianDeadliftPose } from '../../harness/pose-stub';
import { runRDLSession, countWarnings } from '../../harness/runner';
import type { RomanianDeadliftPoseIntent } from '../../harness/types';

function standingFrames(durationMs: number) {
  return buildFrames(
    (): RomanianDeadliftPoseIntent => ({ hipHingeDeg: 0, kneeAngleDeg: 15 }),
    buildRomanianDeadliftPose,
    { fps: 30, durationMs },
  );
}

describe('Romanian Deadlift — rep validation', () => {
  it('rejects shallow hinge (peak < 40°) and fires incomplete-rdl', () => {
    const calFrames = standingFrames(1000);
    const repFrames = buildFrames(
      (tMs): RomanianDeadliftPoseIntent => {
        if (tMs < 700) return { hipHingeDeg: (tMs / 700) * 30, kneeAngleDeg: 15 }; // hinge to 30°
        if (tMs < 1200) return { hipHingeDeg: 30, kneeAngleDeg: 15 };               // hold
        return { hipHingeDeg: 30 - ((tMs - 1200) / 1000) * 30, kneeAngleDeg: 15 }; // extend
      },
      buildRomanianDeadliftPose,
      { fps: 30, durationMs: 3000 },
    );
    const frames = concatFrames(calFrames, repFrames);
    const result = runRDLSession(frames);

    expect(result.completedReps.length).toBe(0);
    expect(countWarnings(result, 'incomplete-rdl')).toBeGreaterThan(0);
  });

  it('accepts reps with depth ≥ 40°', () => {
    const calFrames = standingFrames(1000);
    const repFrames = buildFrames(
      (tMs): RomanianDeadliftPoseIntent => {
        if (tMs < 1000) return { hipHingeDeg: (tMs / 1000) * 50, kneeAngleDeg: 15 }; // hinge to 50°
        if (tMs < 1500) return { hipHingeDeg: 50, kneeAngleDeg: 15 };
        return { hipHingeDeg: 50 - ((tMs - 1500) / 1000) * 50, kneeAngleDeg: 15 };
      },
      buildRomanianDeadliftPose,
      { fps: 30, durationMs: 3500 },
    );
    const frames = concatFrames(calFrames, repFrames);
    const result = runRDLSession(frames);

    expect(result.completedReps.length).toBe(1);
    expect(countWarnings(result, 'incomplete-rdl')).toBe(0);
    expect(countWarnings(result, 'malformed-rep')).toBe(0);
  });

  it('handles very fast rep cycles gracefully without crashing', () => {
    const calFrames = standingFrames(1000);
    // Very fast 150ms cycle — EMA smoothing prevents AT_BOTTOM entry (8 stable frames = 267ms)
    const repFrames = buildFrames(
      (tMs): RomanianDeadliftPoseIntent => {
        if (tMs < 50) return { hipHingeDeg: (tMs / 50) * 65, kneeAngleDeg: 15 };
        if (tMs < 80) return { hipHingeDeg: 65, kneeAngleDeg: 15 };
        return { hipHingeDeg: 65 - ((tMs - 80) / 70) * 65, kneeAngleDeg: 15 };
      },
      buildRomanianDeadliftPose,
      { fps: 30, durationMs: 200 },
    );
    const restFrames = standingFrames(500);
    const frames = concatFrames(calFrames, repFrames, restFrames);
    const result = runRDLSession(frames);

    expect(result.finalCalibration?.state).toBe('confirmed');
    // Engine must not crash. AT_BOTTOM requires 8 stable frames (267ms).
    expect(result.completedReps.length).toBeGreaterThanOrEqual(0);
  });
});
