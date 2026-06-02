import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildWarrior3Pose } from '../../harness/pose-stub';
import { runWarrior3Session, warningsOtherThan } from '../../harness/runner';
import type { Warrior3PoseIntent } from '../../harness/types';

const CAL_MS = 2200;

describe('Warrior III — happy path', () => {
  it('calibrates instantly and holds the airplane T with no warnings', () => {
    const frames = buildFrames(
      () => ({ torsoPitchFromHorizontalDeg: 10, backLegAngleFromHorizontalDeg: 10, standingKneeFlexionDeg: 5 } as Warrior3PoseIntent),
      buildWarrior3Pose,
      { fps: 30, durationMs: CAL_MS + 16_000 },
    );
    const result = runWarrior3Session(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThanOrEqual(2300);
    expect(result.broken).toBe(false);
    expect(warningsOtherThan(result, 'not-moving').length).toBe(0);
    expect(result.holdTicks.length).toBeGreaterThanOrEqual(13);
    const avgMqs = result.holdTicks.reduce((s, t) => s + t.mqs, 0) / result.holdTicks.length;
    expect(avgMqs).toBeGreaterThanOrEqual(85);
  });

  it('reaches a 12s hold on clean form (right-leg-lifted variant)', () => {
    const frames = buildFrames(
      () => ({ torsoPitchFromHorizontalDeg: 8, backLegAngleFromHorizontalDeg: 8, liftedSide: 'right' as const } as Warrior3PoseIntent),
      buildWarrior3Pose,
      { fps: 30, durationMs: CAL_MS + 14_000 },
    );
    const result = runWarrior3Session(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    const lastTick = result.holdTicks[result.holdTicks.length - 1];
    expect(lastTick.secondsElapsed).toBeGreaterThanOrEqual(12);
  });
});
