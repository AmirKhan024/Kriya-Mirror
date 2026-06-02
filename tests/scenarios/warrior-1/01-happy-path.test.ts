import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildWarriorOnePose } from '../../harness/pose-stub';
import { runWarriorOneSession, warningsOtherThan } from '../../harness/runner';
import type { WarriorOnePoseIntent } from '../../harness/types';

const CAL_MS = 2200;

describe('Warrior I — happy path', () => {
  it('calibrates within 2.3s and holds for 25s with no warnings', () => {
    const frames = buildFrames(
      () => ({ frontKneeFlexionDeg: 90, backKneeFlexionDeg: 5, trunkLeanDeg: 5, armsRaised: true } as WarriorOnePoseIntent),
      buildWarriorOnePose,
      { fps: 30, durationMs: CAL_MS + 25_000 },
    );
    const result = runWarriorOneSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThanOrEqual(2300);
    expect(result.broken).toBe(false);
    expect(warningsOtherThan(result, 'not-moving').length).toBe(0);
    expect(result.holdTicks.length).toBeGreaterThanOrEqual(23);
    const avgMqs = result.holdTicks.reduce((s, t) => s + t.mqs, 0) / result.holdTicks.length;
    expect(avgMqs).toBeGreaterThanOrEqual(85);
  });

  it('reaches target hold of 20s on clean form (left-front variant)', () => {
    const frames = buildFrames(
      () => ({ frontKneeFlexionDeg: 88, frontLeg: 'left' as const, side: 'right' as const } as WarriorOnePoseIntent),
      buildWarriorOnePose,
      { fps: 30, durationMs: CAL_MS + 22_000 },
    );
    const result = runWarriorOneSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    const lastTick = result.holdTicks[result.holdTicks.length - 1];
    expect(lastTick.secondsElapsed).toBeGreaterThanOrEqual(20);
  });
});
