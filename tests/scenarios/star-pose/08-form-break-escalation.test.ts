/**
 * Forgiving form-break escalation + shoulder-rise debounce (this fix round).
 *   - First breaks just freeze the timer (recoverable, covered elsewhere).
 *   - SUSTAINED form-break (~7s continuous) ENDS the hold via `hold-broken`.
 *   - A brief wobble that recovers does NOT end the hold.
 *   - A brief shoulder rise (under the debounce) does NOT terminate.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildStarPosePose } from '../../harness/pose-stub';
import { runStarPoseSession, countWarnings } from '../../harness/runner';
import type { StarPosePoseIntent } from '../../harness/types';

const CAL_MS = 2200;

describe('Star Pose — form-break escalation + rise debounce', () => {
  it('ends the hold after a long continuous form-break (escalation → hold-broken)', () => {
    // Clean settle (baseline + grace), then continuous heavy sway to the end.
    const frames = buildFrames(
      (tMs): StarPosePoseIntent => {
        if (tMs - CAL_MS < 1500) return { liftedSide: 'left' };
        return { liftedSide: 'left', swayX: 0.06 };
      },
      buildStarPosePose,
      { fps: 30, durationMs: CAL_MS + 12000 },
    );
    const result = runStarPoseSession(frames);
    expect(result.broken).toBe(true);
    expect(countWarnings(result, 'hold-broken')).toBeGreaterThanOrEqual(1);
  });

  it('does NOT end the hold on a brief wobble that recovers', () => {
    // ~2s of sway then clean — one short break, under the 7s / 5-break limits.
    const frames = buildFrames(
      (tMs): StarPosePoseIntent => {
        const tAfter = tMs - CAL_MS;
        const wobble = tAfter >= 2000 && tAfter < 4000;
        return { liftedSide: 'left', swayX: wobble ? 0.06 : 0 };
      },
      buildStarPosePose,
      { fps: 30, durationMs: CAL_MS + 8000 },
    );
    const result = runStarPoseSession(frames);
    expect(result.broken).toBe(false);
    expect(countWarnings(result, 'swaying')).toBeGreaterThan(0); // it did freeze + nudge
  });

  it('does NOT terminate on a brief shoulder rise (under the debounce)', () => {
    // ~0.3s rise (~9 frames < 18-frame debounce) then back down.
    const frames = buildFrames(
      (tMs): StarPosePoseIntent => {
        const tAfter = tMs - CAL_MS;
        const blip = tAfter >= 3000 && tAfter < 3300;
        return { liftedSide: 'left', shoulderRise: blip ? 0.22 : 0 };
      },
      buildStarPosePose,
      { fps: 30, durationMs: CAL_MS + 6000 },
    );
    const result = runStarPoseSession(frames);
    expect(result.broken).toBe(false);
  });
});
