/**
 * Fix S split — only shoulder rise terminates the hold (user fully stood up).
 * Foot-off-leg and swaying freeze the timer instead (recoverable).
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildStandingFigure4Pose } from '../../harness/pose-stub';
import { runStandingFigure4Session, countWarnings } from '../../harness/runner';
import type { StandingFigure4PoseIntent } from '../../harness/types';

const CAL_MS = 2200;
const HOLD_START = CAL_MS;

describe('Standing Figure-4 — hold-broken (Fix S terminal split)', () => {
  it('terminates ONCE when shoulder rises ≥ 15% (user stood up)', () => {
    const frames = buildFrames(
      (tMs): StandingFigure4PoseIntent => {
        const intoHold = tMs - HOLD_START;
        const shoulderRise = intoHold < 4000 ? 0 : 0.20;
        return { liftedSide: 'left', shoulderRise };
      },
      buildStandingFigure4Pose,
      { fps: 30, durationMs: HOLD_START + 8000 },
    );
    const result = runStandingFigure4Session(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.broken).toBe(true);
    expect(result.brokenAtMs).not.toBeNull();
    expect(countWarnings(result, 'hold-broken')).toBeGreaterThanOrEqual(1);
  });

  it('does NOT terminate on foot-off-leg alone (Fix S recoverable)', () => {
    const frames = buildFrames(
      (tMs): StandingFigure4PoseIntent => {
        const intoHold = tMs - HOLD_START;
        const offset = intoHold < 3000 ? 0 : 0.20;
        return { liftedSide: 'left', liftedAnkleXOffset: offset };
      },
      buildStandingFigure4Pose,
      { fps: 30, durationMs: HOLD_START + 8000 },
    );
    const result = runStandingFigure4Session(frames);
    expect(result.broken).toBe(false);
    expect(countWarnings(result, 'foot-off-leg')).toBeGreaterThan(0);
    expect(countWarnings(result, 'hold-broken')).toBe(0);
  });

  it('does NOT terminate on swaying alone (Fix S recoverable)', () => {
    const frames = buildFrames(
      (tMs): StandingFigure4PoseIntent => {
        const intoHold = tMs - HOLD_START;
        const swayX = intoHold < 3000 ? 0 : 0.05;
        return { liftedSide: 'left', swayX };
      },
      buildStandingFigure4Pose,
      { fps: 30, durationMs: HOLD_START + 8000 },
    );
    const result = runStandingFigure4Session(frames);
    expect(result.broken).toBe(false);
    expect(countWarnings(result, 'swaying')).toBeGreaterThan(0);
    expect(countWarnings(result, 'hold-broken')).toBe(0);
  });
});
