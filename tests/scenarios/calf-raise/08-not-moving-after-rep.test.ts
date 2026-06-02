/**
 * 2026-05-28 round 22: replaces the rep-cycle not-moving-after-rep test. The
 * round-22 hold engine commits accumulated HOLDING time to `accumulatedHoldMs`
 * the moment the state transitions HOLDING → DROPPED. This test validates
 * that a brief hold followed by a permanent drop preserves the seconds-held
 * tally.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildCalfRaisePose } from '../../harness/pose-stub';
import { runCalfRaiseSession } from '../../harness/runner';

const CAL_MS = 2200;
const RISE_MS = 1000;

describe('Calf Raise — hold time committed on heel-drop (round 22)', () => {
  it('preserves the accumulated hold seconds after a permanent drop', () => {
    // Profile:
    //   0-2.2s     : calibration
    //   2.2-3.2s   : rise 0 → 15 %
    //   3.2-7.2s   : hold 15 % for 4 s
    //   7.2-15.2s  : drop to 0 % and stay (8 s idle)
    // Expected: secondsElapsed reflects the 4 s of valid hold.
    const TOTAL_MS = CAL_MS + RISE_MS + 4000 + 8000;
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) return { heelRisePct: 0 };
        const t = tMs - CAL_MS;
        if (t < RISE_MS) return { heelRisePct: (t / RISE_MS) * 15 };
        if (t < RISE_MS + 4000) return { heelRisePct: 15 };
        return { heelRisePct: 0 };
      },
      buildCalfRaisePose,
      { fps: 30, durationMs: TOTAL_MS },
    );

    const result = runCalfRaiseSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    // 4 s of hold should be reflected; allow ±1 s for EMA + warmup lag.
    expect(result.finalSecondsElapsed).toBeGreaterThanOrEqual(3);
    expect(result.finalSecondsElapsed).toBeLessThanOrEqual(5);
    expect(result.finalHeelDropCount).toBe(1);
  });
});
