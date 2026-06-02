/**
 * Fix N — cross-cutting `position-lost` warning. If no usable pose frame
 * (landmarks null OR core body landmarks not visible) for ≥ 3 s post-calibration,
 * the engine emits `position-lost`, repeating at most every 10 s while lost.
 *
 * Core set for seated march is shoulders + hips + knees (NOT ankles — the feet
 * sit near/under the chair).
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildSeatedMarchPose } from '../../harness/pose-stub';
import { runSeatedMarchSession, countWarnings } from '../../harness/runner';
import { IDX } from '../../harness/types';
import type { SeatedMarchPoseIntent } from '../../harness/types';

const CAL_MS = 1000;

describe('Seated March — position-lost (Fix N)', () => {
  it('fires position-lost after 3+ seconds of null landmarks post-calibration', () => {
    const frames = buildFrames(
      (tMs): SeatedMarchPoseIntent | null =>
        tMs < CAL_MS ? { leftKneeLiftPct: 0, rightKneeLiftPct: 0 } : null,
      buildSeatedMarchPose,
      { fps: 30, durationMs: CAL_MS + 4000 },
    );
    const result = runSeatedMarchSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'position-lost')).toBeGreaterThan(0);
  });

  it('fires position-lost when the knees are occluded post-calibration', () => {
    const frames = buildFrames(
      (tMs): SeatedMarchPoseIntent =>
        tMs < CAL_MS
          ? { leftKneeLiftPct: 0, rightKneeLiftPct: 0 }
          : { leftKneeLiftPct: 0, rightKneeLiftPct: 0, occludedIndices: [IDX.leftKnee, IDX.rightKnee] },
      buildSeatedMarchPose,
      { fps: 30, durationMs: CAL_MS + 4000 },
    );
    const result = runSeatedMarchSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'position-lost')).toBeGreaterThan(0);
  });

  it('does NOT fire position-lost on a clean continuous stream', () => {
    const frames = buildFrames(
      (): SeatedMarchPoseIntent => ({ leftKneeLiftPct: 0, rightKneeLiftPct: 0 }),
      buildSeatedMarchPose,
      { fps: 30, durationMs: CAL_MS + 4000 },
    );
    const result = runSeatedMarchSession(frames);
    expect(countWarnings(result, 'position-lost')).toBe(0);
  });
});
