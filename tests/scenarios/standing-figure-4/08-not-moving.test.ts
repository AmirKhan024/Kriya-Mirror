/**
 * Round-20 `not-moving` idle prompt — fires when form has been broken for
 * ≥ 5 s (user out of pose); repeats every 15 s.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildStandingFigure4Pose } from '../../harness/pose-stub';
import { runStandingFigure4Session, countWarnings } from '../../harness/runner';
import type { StandingFigure4PoseIntent } from '../../harness/types';

const CAL_MS = 2200;
const HOLD_START = CAL_MS;

describe('Standing Figure-4 — not-moving idle prompt (round 20)', () => {
  it('fires not-moving after 5 s of sustained form-break (foot off leg)', () => {
    const frames = buildFrames(
      (tMs): StandingFigure4PoseIntent => {
        const intoHold = tMs - HOLD_START;
        const offset = intoHold < 1000 ? 0 : 0.15;
        return { liftedSide: 'left', liftedAnkleXOffset: offset };
      },
      buildStandingFigure4Pose,
      { fps: 30, durationMs: HOLD_START + 10_000 },
    );
    const result = runStandingFigure4Session(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'not-moving')).toBeGreaterThan(0);
  });

  it('does NOT fire not-moving on a clean hold', () => {
    const frames = buildFrames(
      (): StandingFigure4PoseIntent => ({ liftedSide: 'left' }),
      buildStandingFigure4Pose,
      { fps: 30, durationMs: HOLD_START + 10_000 },
    );
    const result = runStandingFigure4Session(frames);
    expect(countWarnings(result, 'not-moving')).toBe(0);
  });

  it('does NOT fire not-moving when form recovers within 5 s', () => {
    const frames = buildFrames(
      (tMs): StandingFigure4PoseIntent => {
        const intoHold = tMs - HOLD_START;
        const offset = (intoHold >= 1000 && intoHold < 4000) ? 0.15 : 0;
        return { liftedSide: 'left', liftedAnkleXOffset: offset };
      },
      buildStandingFigure4Pose,
      { fps: 30, durationMs: HOLD_START + 10_000 },
    );
    const result = runStandingFigure4Session(frames);
    expect(countWarnings(result, 'not-moving')).toBe(0);
  });
});
