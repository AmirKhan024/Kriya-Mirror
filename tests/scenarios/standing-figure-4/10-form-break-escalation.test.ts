/**
 * Forgiving form-break escalation + shoulder-rise debounce (this fix round).
 *   - SUSTAINED form-break (~7s continuous) ENDS the hold via `hold-broken`.
 *   - A brief wobble that recovers does NOT end the hold.
 *   - A brief shoulder rise (under the debounce) does NOT terminate.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildStandingFigure4Pose } from '../../harness/pose-stub';
import { runStandingFigure4Session, countWarnings } from '../../harness/runner';
import type { StandingFigure4PoseIntent } from '../../harness/types';

const CAL_MS = 2200;

describe('Standing Figure-4 — form-break escalation + rise debounce', () => {
  it('ends the hold after a long continuous form-break (escalation → hold-broken)', () => {
    const frames = buildFrames(
      (tMs): StandingFigure4PoseIntent => {
        if (tMs - CAL_MS < 1500) return { liftedSide: 'left' };
        return { liftedSide: 'left', swayX: 0.06 };
      },
      buildStandingFigure4Pose,
      { fps: 30, durationMs: CAL_MS + 12000 },
    );
    const result = runStandingFigure4Session(frames);
    expect(result.broken).toBe(true);
    expect(countWarnings(result, 'hold-broken')).toBeGreaterThanOrEqual(1);
  });

  it('does NOT end the hold on a brief wobble that recovers', () => {
    const frames = buildFrames(
      (tMs): StandingFigure4PoseIntent => {
        const tAfter = tMs - CAL_MS;
        const wobble = tAfter >= 2000 && tAfter < 4000;
        return { liftedSide: 'left', swayX: wobble ? 0.06 : 0 };
      },
      buildStandingFigure4Pose,
      { fps: 30, durationMs: CAL_MS + 8000 },
    );
    const result = runStandingFigure4Session(frames);
    expect(result.broken).toBe(false);
    expect(countWarnings(result, 'swaying')).toBeGreaterThan(0);
  });

  it('does NOT terminate on a brief shoulder rise (under the debounce)', () => {
    const frames = buildFrames(
      (tMs): StandingFigure4PoseIntent => {
        const tAfter = tMs - CAL_MS;
        const blip = tAfter >= 3000 && tAfter < 3300;
        return { liftedSide: 'left', shoulderRise: blip ? 0.22 : 0 };
      },
      buildStandingFigure4Pose,
      { fps: 30, durationMs: CAL_MS + 6000 },
    );
    const result = runStandingFigure4Session(frames);
    expect(result.broken).toBe(false);
  });
});
