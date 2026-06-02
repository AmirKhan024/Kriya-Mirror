/**
 * Fix F: distance gate hysteresis prevents oscillation at the threshold boundary.
 * Enter thresholds (MIN/MAX) are stricter than exit thresholds (MIN−0.02 / MAX+0.02).
 * Once the gate is "in range", it takes slightly more deviation to exit.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildPullUpPose } from '../../harness/pose-stub';
import { runPullUpSession } from '../../harness/runner';
import type { PullUpPoseIntent } from '../../harness/types';

describe('Pull-Up — distance gate hysteresis (Fix F)', () => {
  it('confirms when good distance is held stably', () => {
    const frames = buildFrames(
      () => ({ elbowFlexionDeg: 0 } as PullUpPoseIntent),
      buildPullUpPose,
      { fps: 30, durationMs: 1000 },
    );
    const result = runPullUpSession(frames);
    expect(result.finalCalibration?.checks.distanceOk).toBe(true);
    expect(result.finalCalibration?.state).toBe('confirmed');
  });

  it('does NOT confirm when good posture is repeatedly interrupted by bad posture', () => {
    // Cycle: 100ms good → 400ms bad (> BAD_POSTURE_BUFFER_MS=300ms).
    // The 400ms bad window exceeds the buffer, resetting progress each cycle.
    // Good windows (100ms each) are shorter than CONFIRM_DURATION_MS=200ms → never confirms.
    const frames = buildFrames(
      (tMs) => {
        const cycleMs = tMs % 500;
        const scale = cycleMs < 100 ? 1.0 : 0.5; // 0.5 → bodyHeight=0.35 < 0.40 → too-far
        return { elbowFlexionDeg: 0, bodyHeightScale: scale } as PullUpPoseIntent;
      },
      buildPullUpPose,
      { fps: 30, durationMs: 3000 },
    );
    const result = runPullUpSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
  });
});
