import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildCobraPosePose } from '../../harness/pose-stub';
import { runCobraPoseSession } from '../../harness/runner';
import type { CobraPosePoseIntent } from '../../harness/types';

const CAL_MS = 1000;

describe('Cobra Pose — happy path', () => {
  it('calibrates quickly and holds for 15s with no warnings', () => {
    const frames = buildFrames(
      (): CobraPosePoseIntent => ({ elevationDeg: 28, side: 'left' }),
      buildCobraPosePose,
      { fps: 30, durationMs: CAL_MS + 15_000 },
    );
    const result = runCobraPoseSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThanOrEqual(600);
    expect(result.broken).toBe(false);
    expect(result.warnings.length).toBe(0);
    expect(result.holdTicks.length).toBeGreaterThanOrEqual(13);
    const avgMqs = result.holdTicks.reduce((s, t) => s + t.mqs, 0) / result.holdTicks.length;
    expect(avgMqs).toBeGreaterThanOrEqual(90);
  });

  it('accumulates valid hold time and tracks the longest unfrozen streak', () => {
    const frames = buildFrames(
      (): CobraPosePoseIntent => ({ elevationDeg: 32, side: 'right' }),
      buildCobraPosePose,
      { fps: 30, durationMs: CAL_MS + 18_000 },
    );
    const result = runCobraPoseSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    const lastTick = result.holdTicks[result.holdTicks.length - 1];
    expect(lastTick.secondsElapsed).toBeGreaterThanOrEqual(16);
    expect(lastTick.longestUnfrozenSec).toBeGreaterThanOrEqual(16);
  });
});
