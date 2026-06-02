/**
 * Engine-local runtime distance monitor (owner request): nudges too-far /
 * too-close DURING the hold, sustained ~1 s before firing, with a cold-start
 * sentinel so the first nudge isn't swallowed by its cooldown.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildStandingFigure4Pose } from '../../harness/pose-stub';
import { runStandingFigure4Session, countWarnings } from '../../harness/runner';
import type { StandingFigure4PoseIntent } from '../../harness/types';

const CAL_MS = 2200;
const HOLD_START = CAL_MS;

describe('Standing Figure-4 — runtime distance nudge', () => {
  it('fires too-far when the user drifts too far mid-hold (narrow shoulders)', () => {
    const frames = buildFrames(
      (tMs): StandingFigure4PoseIntent => {
        const intoHold = tMs - HOLD_START;
        // shoulderWidthOverride 0.05 < RUNTIME_MIN_SHOULDER_WIDTH (0.07) → too-far.
        return intoHold < 3000
          ? { liftedSide: 'left' }
          : { liftedSide: 'left', shoulderWidthOverride: 0.05 };
      },
      buildStandingFigure4Pose,
      { fps: 30, durationMs: HOLD_START + 6000 },
    );
    const result = runStandingFigure4Session(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'too-far')).toBeGreaterThan(0);
  });

  it('does NOT fire any distance nudge on a clean, well-framed hold', () => {
    const frames = buildFrames(
      () => ({ liftedSide: 'left' as const } as StandingFigure4PoseIntent),
      buildStandingFigure4Pose,
      { fps: 30, durationMs: HOLD_START + 6000 },
    );
    const result = runStandingFigure4Session(frames);
    expect(countWarnings(result, 'too-far')).toBe(0);
    expect(countWarnings(result, 'too-close')).toBe(0);
  });
});
