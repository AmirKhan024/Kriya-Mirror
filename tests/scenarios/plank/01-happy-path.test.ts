import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildPlankPose } from '../../harness/pose-stub';
import { runPlankSession, warningsOtherThan } from '../../harness/runner';

const CAL_MS = 2200;

describe('Plank — happy path', () => {
  it('calibrates within 2.2s and holds for 30s with no warnings', () => {
    const frames = buildFrames(
      () => ({ hipDelta: 0, side: 'left' as const }),
      buildPlankPose,
      { fps: 30, durationMs: CAL_MS + 30_000 },
    );
    const result = runPlankSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThanOrEqual(2300);
    expect(result.broken).toBe(false);
    expect(warningsOtherThan(result, 'not-moving').length).toBe(0);
    // At least 28 hold ticks (allowing ~2 ticks lost to calibration phase / timing edge)
    expect(result.holdTicks.length).toBeGreaterThanOrEqual(28);
    const avgMqs = result.holdTicks.reduce((s, t) => s + t.mqs, 0) / result.holdTicks.length;
    expect(avgMqs).toBeGreaterThanOrEqual(85);
  });
});
