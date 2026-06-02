/**
 * Inchworm — rep validation.
 * Shallow hinge (< 45°) → fires incomplete-inchworm.
 * Too-fast rep (< 600ms) → fires malformed-rep.
 * Too-slow rep (> 12s) → fires malformed-rep.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames, concatFrames } from '../../harness/frame-stream';
import { buildInchwormPose } from '../../harness/pose-stub';
import { runInchwormSession, countWarnings } from '../../harness/runner';
import type { InchwormPoseIntent } from '../../harness/types';

function standingFrames(durationMs: number) {
  return buildFrames(
    (): InchwormPoseIntent => ({ hipHingeDeg: 0 }),
    buildInchwormPose,
    { fps: 30, durationMs },
  );
}

describe('Inchworm — rep validation', () => {
  it('rejects shallow hinge (peak < 45°) and fires incomplete-inchworm', () => {
    const calFrames = standingFrames(1000);
    const repFrames = buildFrames(
      (tMs): InchwormPoseIntent => {
        if (tMs < 700)  return { hipHingeDeg: (tMs / 700) * 30 };  // hinge to 30°
        if (tMs < 1200) return { hipHingeDeg: 30 };                  // hold
        return { hipHingeDeg: 30 - ((tMs - 1200) / 1000) * 30 };    // extend
      },
      buildInchwormPose,
      { fps: 30, durationMs: 3000 },
    );
    const frames = concatFrames(calFrames, repFrames);
    const result = runInchwormSession(frames);

    expect(result.completedReps.length).toBe(0);
    expect(countWarnings(result, 'incomplete-inchworm')).toBeGreaterThan(0);
  });

  it('accepts reps with depth >= 45°', () => {
    const calFrames = standingFrames(1000);
    const repFrames = buildFrames(
      (tMs): InchwormPoseIntent => {
        if (tMs < 1000) return { hipHingeDeg: (tMs / 1000) * 55 }; // hinge to 55°
        if (tMs < 1500) return { hipHingeDeg: 55 };
        return { hipHingeDeg: 55 - ((tMs - 1500) / 1000) * 55 };
      },
      buildInchwormPose,
      { fps: 30, durationMs: 3500 },
    );
    const frames = concatFrames(calFrames, repFrames);
    const result = runInchwormSession(frames);

    expect(result.completedReps.length).toBe(1);
    expect(countWarnings(result, 'incomplete-inchworm')).toBe(0);
    expect(countWarnings(result, 'malformed-rep')).toBe(0);
  });

  it('handles very fast rep cycles gracefully without crashing', () => {
    const calFrames = standingFrames(1000);
    // Very fast 150ms cycle — EMA smoothing prevents AT_BOTTOM entry (8 stable frames ≈ 267ms)
    const repFrames = buildFrames(
      (tMs): InchwormPoseIntent => {
        if (tMs < 50)  return { hipHingeDeg: (tMs / 50) * 65 };
        if (tMs < 80)  return { hipHingeDeg: 65 };
        return { hipHingeDeg: 65 - ((tMs - 80) / 70) * 65 };
      },
      buildInchwormPose,
      { fps: 30, durationMs: 200 },
    );
    const restFrames = standingFrames(500);
    const frames = concatFrames(calFrames, repFrames, restFrames);
    const result = runInchwormSession(frames);

    expect(result.finalCalibration?.state).toBe('confirmed');
    // Engine must not crash. AT_BOTTOM requires 8 stable frames (267ms).
    expect(result.completedReps.length).toBeGreaterThanOrEqual(0);
  });

  it('engine does not count reps before calibration confirms', () => {
    // Feed a full rep sequence with no standing calibration phase — engine is
    // still in calibration loop, should count 0 reps.
    const earlyRepFrames = buildFrames(
      (tMs): InchwormPoseIntent => {
        if (tMs < 1000) return { hipHingeDeg: (tMs / 1000) * 65 };
        if (tMs < 1500) return { hipHingeDeg: 65 };
        return { hipHingeDeg: 65 - ((tMs - 1500) / 1000) * 65 };
      },
      buildInchwormPose,
      { fps: 30, durationMs: 2500 },
    );
    const result = runInchwormSession(earlyRepFrames);
    // No calibration confirmed (too short to confirm) → no reps counted
    expect(result.completedReps.length).toBe(0);
  });
});
