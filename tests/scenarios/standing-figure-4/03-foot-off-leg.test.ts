/**
 * `foot-off-leg` warning — crossed ankle X drifts away from the standing-knee X
 * by more than FOOT_ON_LEG_X_TOLERANCE = 0.12 for 6+ frames (Fix V hysteresis)
 * → warning fires, timer freezes (Fix S recoverable).
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildStandingFigure4Pose } from '../../harness/pose-stub';
import { runStandingFigure4Session, countWarnings } from '../../harness/runner';
import type { StandingFigure4PoseIntent } from '../../harness/types';

const CAL_MS = 2200;
const HOLD_START = CAL_MS;

describe('Standing Figure-4 — foot-off-leg warning', () => {
  it('fires foot-off-leg when the crossed foot drifts off the standing knee', () => {
    const frames = buildFrames(
      (tMs): StandingFigure4PoseIntent => {
        const intoHold = tMs - HOLD_START;
        const offset = intoHold < 3000 ? 0 : 0.20;
        return { liftedSide: 'left', liftedAnkleXOffset: offset };
      },
      buildStandingFigure4Pose,
      { fps: 30, durationMs: HOLD_START + 6000 },
    );
    const result = runStandingFigure4Session(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'foot-off-leg')).toBeGreaterThan(0);
    expect(result.broken).toBe(false); // recoverable, not terminal
  });

  it('does NOT fire foot-off-leg when foot stays within tolerance (0.04 offset)', () => {
    const frames = buildFrames(
      () => ({ liftedSide: 'left' as const, liftedAnkleXOffset: 0.04 } as StandingFigure4PoseIntent),
      buildStandingFigure4Pose,
      { fps: 30, durationMs: HOLD_START + 5000 },
    );
    const result = runStandingFigure4Session(frames);
    expect(countWarnings(result, 'foot-off-leg')).toBe(0);
  });

  it('momentary foot drift (4 frames) does NOT trigger the warning (Fix V hysteresis)', () => {
    const frames = buildFrames(
      (tMs): StandingFigure4PoseIntent => {
        const intoHold = tMs - HOLD_START;
        const isSpike = intoHold >= 1500 && intoHold <= 1633;
        return { liftedSide: 'left', liftedAnkleXOffset: isSpike ? 0.20 : 0 };
      },
      buildStandingFigure4Pose,
      { fps: 30, durationMs: HOLD_START + 4000 },
    );
    const result = runStandingFigure4Session(frames);
    expect(countWarnings(result, 'foot-off-leg')).toBe(0);
  });
});
