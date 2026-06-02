import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildTandemStandPose } from '../../harness/pose-stub';
import { runTandemStandSession, warningsOtherThan } from '../../harness/runner';

const CAL_MS = 2200;

describe('Tandem Stand — happy path', () => {
  it('calibrates within 2.2s and holds 20s with no warnings', () => {
    const frames = buildFrames(
      () => ({ tandemAhead: 'left' as const }),
      buildTandemStandPose,
      { fps: 30, durationMs: CAL_MS + 20_000 },
    );
    const result = runTandemStandSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThanOrEqual(2300);
    expect(result.broken).toBe(false);
    expect(warningsOtherThan(result).length).toBe(0);
    // Should emit ~19 hold ticks across the 20-second hold (1Hz, allowing
    // 1s lost to the rolling baseline capture + edge timing).
    expect(result.holdTicks.length).toBeGreaterThanOrEqual(17);
    const avgMqs = result.holdTicks.reduce((s, t) => s + t.mqs, 0) / result.holdTicks.length;
    expect(avgMqs).toBeGreaterThanOrEqual(85);
  });

  it('works on the right side (foot ahead = right)', () => {
    const frames = buildFrames(
      () => ({ tandemAhead: 'right' as const }),
      buildTandemStandPose,
      { fps: 30, durationMs: CAL_MS + 10_000 },
    );
    const result = runTandemStandSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.broken).toBe(false);
  });
});
