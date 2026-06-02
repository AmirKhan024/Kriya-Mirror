/**
 * Forgiving form-break escalation + shoulder-rise debounce (this fix round).
 *   - SUSTAINED form-break (~7s continuous out of the bend) ENDS the hold via
 *     `hold-broken`.
 *   - A brief come-up that recovers does NOT end the hold.
 *   - A brief shoulder rise (under the debounce) does NOT terminate.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildGatePosePose } from '../../harness/pose-stub';
import { runGatePoseSession, countWarnings } from '../../harness/runner';
import type { GatePosePoseIntent } from '../../harness/types';

const CAL_MS = 2200;

describe('Gate Pose — form-break escalation + rise debounce', () => {
  it('ends the hold after a long continuous form-break (escalation → hold-broken)', () => {
    // Settle in the bend, then come up out of it and stay there.
    const frames = buildFrames(
      (tMs): GatePosePoseIntent => {
        if (tMs - CAL_MS < 1500) return { bendSide: 'right', leanDeg: 30 };
        return { bendSide: 'right', leanDeg: 3 };
      },
      buildGatePosePose,
      { fps: 30, durationMs: CAL_MS + 12000 },
    );
    const result = runGatePoseSession(frames);
    expect(result.broken).toBe(true);
    expect(countWarnings(result, 'hold-broken')).toBeGreaterThanOrEqual(1);
  });

  it('does NOT end the hold on a brief come-up that recovers', () => {
    const frames = buildFrames(
      (tMs): GatePosePoseIntent => {
        const tAfter = tMs - CAL_MS;
        const up = tAfter >= 2000 && tAfter < 4000;
        return { bendSide: 'right', leanDeg: up ? 3 : 30 };
      },
      buildGatePosePose,
      { fps: 30, durationMs: CAL_MS + 8000 },
    );
    const result = runGatePoseSession(frames);
    expect(result.broken).toBe(false);
    expect(countWarnings(result, 'incomplete-bend')).toBeGreaterThan(0);
  });

  it('does NOT terminate on a brief shoulder rise (under the debounce)', () => {
    const frames = buildFrames(
      (tMs): GatePosePoseIntent => {
        const tAfter = tMs - CAL_MS;
        const blip = tAfter >= 3000 && tAfter < 3300;
        return { bendSide: 'right', leanDeg: 30, shoulderRise: blip ? 0.22 : 0 };
      },
      buildGatePosePose,
      { fps: 30, durationMs: CAL_MS + 6000 },
    );
    const result = runGatePoseSession(frames);
    expect(result.broken).toBe(false);
  });
});
