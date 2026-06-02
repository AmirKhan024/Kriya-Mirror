/**
 * Regression: no immediate 'not-moving' after calibration confirms (Fix I + P).
 * standingSince = 0 at construction caused first post-cal frame to report
 * idleMs = (now - 0) = millions, instantly firing 'not-moving'.
 * Fix: initialize standingSince = now on cal-confirm (Fix P init seed).
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildInchwormPose } from '../../harness/pose-stub';
import { runInchwormSession, countWarnings } from '../../harness/runner';
import type { InchwormPoseIntent } from '../../harness/types';

describe('Inchworm — regression: no immediate not-moving after calibration (Fix I+P)', () => {
  it('does NOT fire not-moving within 3s after calibration confirms', () => {
    // Calibration confirms in ~200ms. 3s of standing still is under 5s threshold.
    const frames = buildFrames(
      (): InchwormPoseIntent => ({ hipHingeDeg: 0 }),
      buildInchwormPose,
      { fps: 30, durationMs: 3200 },
    );

    const result = runInchwormSession(frames);

    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThan(500);
    expect(countWarnings(result, 'not-moving')).toBe(0);
  });

  it('DOES fire not-moving after 6s idle post-calibration', () => {
    const frames = buildFrames(
      (): InchwormPoseIntent => ({ hipHingeDeg: 0 }),
      buildInchwormPose,
      { fps: 30, durationMs: 7500 },
    );

    const result = runInchwormSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'not-moving')).toBeGreaterThan(0);
  });
});
