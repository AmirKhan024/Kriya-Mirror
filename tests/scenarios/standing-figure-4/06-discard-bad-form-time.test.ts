/**
 * Fix B (wrong gets discarded) + Fix V (entry/exit hysteresis): sustained
 * bad-form periods freeze the accumulator. Profile: 10s clean → 5s sustained
 * foot-off-leg → 5s clean. Expected ~15s of valid time (the 5s window discarded).
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildStandingFigure4Pose } from '../../harness/pose-stub';
import { runStandingFigure4Session, countWarnings } from '../../harness/runner';
import type { StandingFigure4PoseIntent } from '../../harness/types';

const CAL_MS = 2200;
const HOLD_START = CAL_MS;

describe('Standing Figure-4 — bad-form time is discarded (Fix B + Fix V)', () => {
  it('freezes the hold counter during sustained foot-off-leg', () => {
    const frames = buildFrames(
      (tMs): StandingFigure4PoseIntent => {
        const intoHold = tMs - HOLD_START;
        if (intoHold < 10_000 || intoHold >= 15_000) {
          return { liftedSide: 'left', liftedAnkleXOffset: 0 };
        }
        return { liftedSide: 'left', liftedAnkleXOffset: 0.20 };
      },
      buildStandingFigure4Pose,
      { fps: 30, durationMs: HOLD_START + 20_000 },
    );
    const result = runStandingFigure4Session(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.broken).toBe(false);
    expect(countWarnings(result, 'foot-off-leg')).toBeGreaterThan(0);

    const lastTick = result.holdTicks[result.holdTicks.length - 1];
    expect(lastTick.secondsElapsed).toBeLessThanOrEqual(17);
    expect(lastTick.secondsElapsed).toBeGreaterThanOrEqual(13);
  });

  it('a sustained > 1s break commits and resets the longest-hold streak (Fix U)', () => {
    const frames = buildFrames(
      (tMs): StandingFigure4PoseIntent => {
        const intoHold = tMs - HOLD_START;
        const swayPhase = intoHold >= 3000 && intoHold < 5000;
        return { liftedSide: 'left', swayX: swayPhase ? 0.05 : 0 };
      },
      buildStandingFigure4Pose,
      { fps: 30, durationMs: HOLD_START + 8000 },
    );
    const result = runStandingFigure4Session(frames);
    const lastTick = result.holdTicks[result.holdTicks.length - 1];
    expect(lastTick).toBeDefined();
    expect(lastTick.longestUnfrozenSec).toBeDefined();
    expect(lastTick.longestUnfrozenSec!).toBeGreaterThanOrEqual(2);
    expect(lastTick.longestUnfrozenSec!).toBeLessThanOrEqual(5);
  });
});
