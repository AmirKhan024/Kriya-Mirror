import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildGoddessPosePose } from '../../harness/pose-stub';
import { runGoddessPoseSession, warningsOtherThan } from '../../harness/runner';
import type { GoddessPosePoseIntent } from '../../harness/types';

const CAL_MS = 2200;

describe('Goddess Pose — happy path', () => {
  it('calibrates within 2.3s and holds for 30s with no warnings', () => {
    const frames = buildFrames(
      () => ({ kneeFlexionDeg: 90 } as GoddessPosePoseIntent),
      buildGoddessPosePose,
      { fps: 30, durationMs: CAL_MS + 30_000 },
    );
    const result = runGoddessPoseSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThanOrEqual(2300);
    expect(result.broken).toBe(false);
    expect(warningsOtherThan(result).length).toBe(0);
    expect(result.holdTicks.length).toBeGreaterThanOrEqual(28);
    const avgMqs = result.holdTicks.reduce((s, t) => s + t.mqs, 0) / result.holdTicks.length;
    expect(avgMqs).toBeGreaterThanOrEqual(85);
  });

  it('reaches target hold of 30s with clean form (knee flex at top of range)', () => {
    const frames = buildFrames(
      () => ({ kneeFlexionDeg: 100, trunkLeanDeg: 5 } as GoddessPosePoseIntent),
      buildGoddessPosePose,
      { fps: 30, durationMs: CAL_MS + 32_000 },
    );
    const result = runGoddessPoseSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    const lastTick = result.holdTicks[result.holdTicks.length - 1];
    expect(lastTick.secondsElapsed).toBeGreaterThanOrEqual(28);
  });
});
