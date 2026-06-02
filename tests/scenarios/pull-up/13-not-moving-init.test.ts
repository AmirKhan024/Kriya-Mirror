/**
 * Regression: Fix I (round 5 §3.7) — idle tracking initialized on cal-confirm,
 * not at construction. Without the fix, hangingSince=0 at construction caused
 * idleMs=(now−0)=huge → not-moving fires immediately post-calibration.
 * Fix P (cold-start sentinel): lastNoMovementWarnAt===0 means "never fired",
 * so the first idle warning is not suppressed by the 15s repeat cooldown.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildPullUpPose } from '../../harness/pose-stub';
import { runPullUpSession, countWarnings } from '../../harness/runner';
import type { PullUpPoseIntent } from '../../harness/types';

describe('Pull-Up — regression: no immediate "not-moving" after calibration', () => {
  it('does NOT fire not-moving within the first 3s after calibration confirms', () => {
    const frames = buildFrames(
      () => ({ elbowFlexionDeg: 0 } as PullUpPoseIntent),
      buildPullUpPose,
      { fps: 30, durationMs: 3200 },
    );
    const result = runPullUpSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThan(500);
    expect(countWarnings(result, 'not-moving')).toBe(0);
  });

  it('DOES fire not-moving after sustained idle past 5s post-calibration', () => {
    const frames = buildFrames(
      () => ({ elbowFlexionDeg: 0 } as PullUpPoseIntent),
      buildPullUpPose,
      { fps: 30, durationMs: 8500 },
    );
    const result = runPullUpSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'not-moving')).toBeGreaterThan(0);
  });
});
