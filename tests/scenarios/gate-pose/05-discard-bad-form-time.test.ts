/**
 * Fix B (wrong gets discarded) + Fix V (hysteresis) + Fix U (longest streak):
 * sustained bad form freezes the accumulator. Profile: 10s clean → 5s shallow
 * bend (incomplete-bend) → 5s clean. Expected ~15s of valid time.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildGatePosePose } from '../../harness/pose-stub';
import { runGatePoseSession, countWarnings } from '../../harness/runner';
import type { GatePosePoseIntent } from '../../harness/types';

const CAL_MS = 2200;
const HOLD_START = CAL_MS;

describe('Gate Pose — bad-form time is discarded (Fix B + Fix V)', () => {
  it('freezes the hold counter during a sustained shallow bend', () => {
    const frames = buildFrames(
      (tMs): GatePosePoseIntent => {
        const intoHold = tMs - HOLD_START;
        if (intoHold < 10_000 || intoHold >= 15_000) {
          return { bendSide: 'right', leanDeg: 30 };
        }
        return { bendSide: 'right', leanDeg: 5 };
      },
      buildGatePosePose,
      { fps: 30, durationMs: HOLD_START + 20_000 },
    );
    const result = runGatePoseSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.broken).toBe(false);
    expect(countWarnings(result, 'incomplete-bend')).toBeGreaterThan(0);

    const lastTick = result.holdTicks[result.holdTicks.length - 1];
    expect(lastTick.secondsElapsed).toBeLessThanOrEqual(18);
    expect(lastTick.secondsElapsed).toBeGreaterThanOrEqual(13);
  });

  it('a sustained > 1s break commits and resets the longest-hold streak (Fix U)', () => {
    const frames = buildFrames(
      (tMs): GatePosePoseIntent => {
        const intoHold = tMs - HOLD_START;
        const shallow = intoHold >= 3000 && intoHold < 5500;
        return { bendSide: 'right', leanDeg: shallow ? 5 : 30 };
      },
      buildGatePosePose,
      { fps: 30, durationMs: HOLD_START + 9000 },
    );
    const result = runGatePoseSession(frames);
    const lastTick = result.holdTicks[result.holdTicks.length - 1];
    expect(lastTick).toBeDefined();
    expect(lastTick.longestUnfrozenSec).toBeDefined();
    expect(lastTick.longestUnfrozenSec!).toBeGreaterThanOrEqual(2);
    expect(lastTick.longestUnfrozenSec!).toBeLessThanOrEqual(6);
  });
});
