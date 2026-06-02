/**
 * Fix S split — only shoulder rise terminates the hold (user came all the way
 * up). Coming up out of the bend (incomplete-bend) freezes the timer instead.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildGatePosePose } from '../../harness/pose-stub';
import { runGatePoseSession, countWarnings } from '../../harness/runner';
import type { GatePosePoseIntent } from '../../harness/types';

const CAL_MS = 2200;
const HOLD_START = CAL_MS;

describe('Gate Pose — hold-broken (Fix S terminal split)', () => {
  it('terminates ONCE when shoulder rises ≥ 15% (user stood up)', () => {
    const frames = buildFrames(
      (tMs): GatePosePoseIntent => {
        const intoHold = tMs - HOLD_START;
        const shoulderRise = intoHold < 4000 ? 0 : 0.20;
        return { bendSide: 'right', shoulderRise };
      },
      buildGatePosePose,
      { fps: 30, durationMs: HOLD_START + 8000 },
    );
    const result = runGatePoseSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.broken).toBe(true);
    expect(result.brokenAtMs).not.toBeNull();
    expect(countWarnings(result, 'hold-broken')).toBeGreaterThanOrEqual(1);
  });

  it('does NOT terminate on incomplete-bend alone (Fix S recoverable)', () => {
    const frames = buildFrames(
      (tMs): GatePosePoseIntent => {
        const intoHold = tMs - HOLD_START;
        const leanDeg = intoHold < 3000 ? 30 : 5;
        return { bendSide: 'right', leanDeg };
      },
      buildGatePosePose,
      { fps: 30, durationMs: HOLD_START + 8000 },
    );
    const result = runGatePoseSession(frames);
    expect(result.broken).toBe(false);
    expect(countWarnings(result, 'incomplete-bend')).toBeGreaterThan(0);
    expect(countWarnings(result, 'hold-broken')).toBe(0);
  });
});
