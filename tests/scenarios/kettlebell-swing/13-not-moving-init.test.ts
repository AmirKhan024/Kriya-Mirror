/**
 * Kettlebell Swing — not-moving fires after 5s idle post-calibration.
 * Fix I + Fix P: idle tracking seeded on cal-confirm, first fire at 5s.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildKBSwingPose } from '../../harness/pose-stub';
import { runKBSwingSession, countWarnings } from '../../harness/runner';
import type { KBSwingPoseIntent } from '../../harness/types';

const CAL_MS = 1000;

describe('Kettlebell Swing — not-moving (idle detection init)', () => {
  it('fires not-moving after 5s idle post-calibration', () => {
    // Calibrate for 1s, then stand idle for 7s. not-moving must fire at ~5s.
    const TOTAL_MS = CAL_MS + 7000;
    const frames = buildFrames(
      (tMs): KBSwingPoseIntent => ({ hipHingeDeg: 0 }),
      buildKBSwingPose,
      { fps: 30, durationMs: TOTAL_MS },
    );

    const result = runKBSwingSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'not-moving')).toBeGreaterThanOrEqual(1);

    // Verify it fires AFTER calibration confirms (not before)
    const notMovingWarnings = result.warnings.filter((w) => w.type === 'not-moving');
    const calConfirmedAt = result.calibrationConfirmedAtMs ?? 0;
    for (const w of notMovingWarnings) {
      expect(w.atMs).toBeGreaterThan(calConfirmedAt);
    }
  });

  it('does NOT fire not-moving within the first 5s after calibration', () => {
    // Calibrate for 1s, then idle for only 3s. not-moving must NOT fire.
    const TOTAL_MS = CAL_MS + 3000;
    const frames = buildFrames(
      (): KBSwingPoseIntent => ({ hipHingeDeg: 0 }),
      buildKBSwingPose,
      { fps: 30, durationMs: TOTAL_MS },
    );

    const result = runKBSwingSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'not-moving')).toBe(0);
  });
});
