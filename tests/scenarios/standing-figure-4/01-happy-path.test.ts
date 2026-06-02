import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildStandingFigure4Pose } from '../../harness/pose-stub';
import { runStandingFigure4Session, warningsOtherThan } from '../../harness/runner';
import type { StandingFigure4PoseIntent } from '../../harness/types';

const CAL_MS = 2200;

describe('Standing Figure-4 — happy path', () => {
  it('calibrates within 2.3s and holds for 20s with no warnings (left crossed)', () => {
    const frames = buildFrames(
      () => ({ liftedSide: 'left' as const, wrists: 'chest' as const } as StandingFigure4PoseIntent),
      buildStandingFigure4Pose,
      { fps: 30, durationMs: CAL_MS + 20_000 },
    );
    const result = runStandingFigure4Session(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThanOrEqual(2300);
    expect(result.broken).toBe(false);
    expect(warningsOtherThan(result, 'not-moving').length).toBe(0);
    expect(result.holdTicks.length).toBeGreaterThanOrEqual(17);
    const avgMqs = result.holdTicks.reduce((s, t) => s + t.mqs, 0) / result.holdTicks.length;
    expect(avgMqs).toBeGreaterThanOrEqual(85);
  });

  it('also works with the right ankle crossed', () => {
    const frames = buildFrames(
      () => ({ liftedSide: 'right' as const, wrists: 'chest' as const } as StandingFigure4PoseIntent),
      buildStandingFigure4Pose,
      { fps: 30, durationMs: CAL_MS + 10_000 },
    );
    const result = runStandingFigure4Session(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.broken).toBe(false);
    const lastTick = result.holdTicks[result.holdTicks.length - 1];
    expect(lastTick.secondsElapsed).toBeGreaterThanOrEqual(8);
  });
});
