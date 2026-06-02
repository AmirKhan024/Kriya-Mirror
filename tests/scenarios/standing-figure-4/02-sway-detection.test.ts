import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildStandingFigure4Pose } from '../../harness/pose-stub';
import { runStandingFigure4Session, countWarnings } from '../../harness/runner';
import type { StandingFigure4PoseIntent } from '../../harness/types';

const CAL_MS = 2200;

describe('Standing Figure-4 — sway detection', () => {
  it('fires swaying when CoM displacement exceeds the 12° threshold', () => {
    const frames = buildFrames(
      (tMs) => {
        const intoHold = tMs - CAL_MS;
        const swayX = intoHold > 1500 ? 0.05 : 0;
        return { liftedSide: 'left' as const, swayX } as StandingFigure4PoseIntent;
      },
      buildStandingFigure4Pose,
      { fps: 30, durationMs: CAL_MS + 5000 },
    );
    const result = runStandingFigure4Session(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'swaying')).toBeGreaterThan(0);
    expect(result.broken).toBe(false);
  });

  it('does NOT fire swaying on a clean steady hold', () => {
    const frames = buildFrames(
      () => ({ liftedSide: 'left' as const } as StandingFigure4PoseIntent),
      buildStandingFigure4Pose,
      { fps: 30, durationMs: CAL_MS + 5000 },
    );
    const result = runStandingFigure4Session(frames);
    expect(countWarnings(result, 'swaying')).toBe(0);
  });

  it('does NOT over-freeze a FAR hold (small shoulderWidth) on a moderate wobble', () => {
    // Far user calibrates at shoulderWidth ~0.09; the 0.12 runtime floor keeps
    // swayX 0.03 at ~14° (atan(0.03/0.12)) — under the 16° gate.
    const frames = buildFrames(
      (tMs) => {
        const base = { liftedSide: 'left' as const, shoulderWidthOverride: 0.09 };
        if (tMs - CAL_MS < 2500) return base as StandingFigure4PoseIntent;
        return { ...base, swayX: 0.03 } as StandingFigure4PoseIntent;
      },
      buildStandingFigure4Pose,
      { fps: 30, durationMs: CAL_MS + 7000 },
    );
    const result = runStandingFigure4Session(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'swaying')).toBe(0);
    const lastTick = result.holdTicks[result.holdTicks.length - 1];
    expect(lastTick.secondsElapsed).toBeGreaterThanOrEqual(5); // never froze
  });

  it('momentary sway jitter (4 frames) does NOT fire (Fix V hysteresis)', () => {
    const frames = buildFrames(
      (tMs) => {
        const intoHold = tMs - CAL_MS;
        const isSpike = intoHold >= 2000 && intoHold <= 2120;
        return { liftedSide: 'left' as const, swayX: isSpike ? 0.06 : 0 } as StandingFigure4PoseIntent;
      },
      buildStandingFigure4Pose,
      { fps: 30, durationMs: CAL_MS + 5000 },
    );
    const result = runStandingFigure4Session(frames);
    expect(countWarnings(result, 'swaying')).toBe(0);
  });
});
