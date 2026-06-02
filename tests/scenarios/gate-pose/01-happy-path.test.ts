import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildGatePosePose } from '../../harness/pose-stub';
import { runGatePoseSession, warningsOtherThan } from '../../harness/runner';
import type { GatePosePoseIntent } from '../../harness/types';

const CAL_MS = 2200;

describe('Gate Pose — happy path', () => {
  it('calibrates within 2.3s and holds 20s with no warnings (bend right)', () => {
    const frames = buildFrames(
      () => ({ bendSide: 'right' as const } as GatePosePoseIntent),
      buildGatePosePose,
      { fps: 30, durationMs: CAL_MS + 20_000 },
    );
    const result = runGatePoseSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThanOrEqual(2300);
    expect(result.broken).toBe(false);
    expect(warningsOtherThan(result).length).toBe(0);
    expect(result.holdTicks.length).toBeGreaterThanOrEqual(17);
    const avgMqs = result.holdTicks.reduce((s, t) => s + t.mqs, 0) / result.holdTicks.length;
    expect(avgMqs).toBeGreaterThanOrEqual(85);
  });

  it('also works bending to the left', () => {
    const frames = buildFrames(
      () => ({ bendSide: 'left' as const } as GatePosePoseIntent),
      buildGatePosePose,
      { fps: 30, durationMs: CAL_MS + 10_000 },
    );
    const result = runGatePoseSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.broken).toBe(false);
    expect(warningsOtherThan(result).length).toBe(0);
  });
});
