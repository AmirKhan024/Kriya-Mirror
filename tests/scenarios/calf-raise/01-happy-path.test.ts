/**
 * 2026-05-28 round 22: Calf Raise re-architected as HOLD-based (heel-rise
 * hold, BB6 pattern). Tests now assert hold-tick behavior, not rep records.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildCalfRaisePose } from '../../harness/pose-stub';
import { runCalfRaiseSession } from '../../harness/runner';

const CAL_MS = 2200;
const RISE_MS = 1000;        // time for user to lift from flat-foot to held position
const HOLD_TARGET_SEC = 20;  // round-22 default

describe('Calf Raise — heel-rise hold happy path', () => {
  it('calibrates within 2.2 s then accumulates 20 s of hold time on a clean rise', () => {
    // Profile:
    //   0-2.2s     : flat-foot calibration
    //   2.2-3.2s   : ramp from 0 → 15 % heel-rise (user lifting onto toes)
    //   3.2-23.2s  : sustained 15 % hold (matches target duration)
    const TOTAL_MS = CAL_MS + RISE_MS + HOLD_TARGET_SEC * 1000 + 500;
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) return { heelRisePct: 0 };
        if (tMs < CAL_MS + RISE_MS) {
          const u = (tMs - CAL_MS) / RISE_MS;
          return { heelRisePct: u * 15 };
        }
        return { heelRisePct: 15 };
      },
      buildCalfRaisePose,
      { fps: 30, durationMs: TOTAL_MS },
    );

    const result = runCalfRaiseSession(frames, { targetDurationSec: HOLD_TARGET_SEC });

    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThanOrEqual(2300);
    // Engine should accumulate ≥ target duration with zero heel-drops.
    expect(result.finalSecondsElapsed).toBeGreaterThanOrEqual(HOLD_TARGET_SEC - 1);
    expect(result.finalHeelDropCount).toBe(0);
    expect(result.holdBroken).toBe(false);
    // No heel-dropped warnings on a clean sustained hold.
    const drops = result.warnings.filter((w) => w.type === 'heel-dropped').length;
    expect(drops).toBe(0);
  });

  it('emits hold-tick events at approximately 1 Hz cadence', () => {
    const TOTAL_MS = CAL_MS + RISE_MS + 6000;
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) return { heelRisePct: 0 };
        if (tMs < CAL_MS + RISE_MS) {
          const u = (tMs - CAL_MS) / RISE_MS;
          return { heelRisePct: u * 15 };
        }
        return { heelRisePct: 15 };
      },
      buildCalfRaisePose,
      { fps: 30, durationMs: TOTAL_MS },
    );

    const result = runCalfRaiseSession(frames);
    // At least 6 ticks should have fired in the 6 s post-rise hold phase.
    expect(result.holdTicks.length).toBeGreaterThanOrEqual(6);
    // secondsElapsed values must be non-decreasing.
    for (let i = 1; i < result.holdTicks.length; i++) {
      expect(result.holdTicks[i].secondsElapsed).toBeGreaterThanOrEqual(result.holdTicks[i - 1].secondsElapsed);
    }
  });
});
