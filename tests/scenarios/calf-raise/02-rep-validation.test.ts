/**
 * 2026-05-28 round 22: replaces the prior rep-validation suite. Calf Raise is
 * now a HOLD, so the "validation" surface is heel-drop detection:
 *   - drop pauses the timer + emits ONE heel-dropped warning (cooldown-throttled)
 *   - recovery resumes the timer
 *   - the timer reflects ONLY valid hold time, not wall-clock elapsed
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildCalfRaisePose } from '../../harness/pose-stub';
import { runCalfRaiseSession } from '../../harness/runner';

const CAL_MS = 2200;
const RISE_MS = 1000;

describe('Calf Raise — heel-drop pause behavior', () => {
  it('pauses timer + emits ONE warning during a transient heel drop, resumes on recovery', () => {
    // Phase plan (after CAL_MS):
    //   0-1000 ms  : rise 0 → 15%
    //   1000-6000  : hold 15% (5 s valid hold)
    //   6000-8000  : drop to 0% for 2 s
    //   8000-9000  : recover ramp 0 → 15%
    //   9000-14000 : hold 15% another 5 s
    // Expected: secondsElapsed ≈ 10 (5 + 5), heelDropCount = 1, drops in warnings list.
    const TOTAL_MS = CAL_MS + 14_000 + 500;
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) return { heelRisePct: 0 };
        const t = tMs - CAL_MS;
        if (t < RISE_MS) return { heelRisePct: (t / RISE_MS) * 15 };
        if (t < 6000) return { heelRisePct: 15 };
        if (t < 8000) return { heelRisePct: 0 };
        if (t < 9000) return { heelRisePct: ((t - 8000) / 1000) * 15 };
        return { heelRisePct: 15 };
      },
      buildCalfRaisePose,
      { fps: 30, durationMs: TOTAL_MS },
    );

    const result = runCalfRaiseSession(frames);

    expect(result.finalSecondsElapsed).toBeGreaterThanOrEqual(8);
    expect(result.finalSecondsElapsed).toBeLessThanOrEqual(11);
    expect(result.finalHeelDropCount).toBe(1);
    const drops = result.warnings.filter((w) => w.type === 'heel-dropped').length;
    expect(drops).toBe(1);
  });

  it('does NOT fire heel-dropped warnings on sustained low-amplitude jitter', () => {
    // User holds at 14-16% heel-rise (slight wiggle ±1 %). The smoothed
    // elevation should stay above the adaptive drop threshold (P90 × 0.50).
    // No drop warning should fire even over 8 s of continuous noise.
    const TOTAL_MS = CAL_MS + RISE_MS + 8000;
    let phase = 0;
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) return { heelRisePct: 0 };
        const t = tMs - CAL_MS;
        if (t < RISE_MS) return { heelRisePct: (t / RISE_MS) * 15 };
        // Sinusoidal jitter ±1 % at ~3 Hz.
        phase += 0.6;
        return { heelRisePct: 15 + Math.sin(phase) };
      },
      buildCalfRaisePose,
      { fps: 30, durationMs: TOTAL_MS },
    );

    const result = runCalfRaiseSession(frames);
    const drops = result.warnings.filter((w) => w.type === 'heel-dropped').length;
    expect(drops).toBe(0);
    expect(result.finalHeelDropCount).toBe(0);
  });

  it('does NOT fire heel-dropped from single-frame outliers (8-frame confirmation)', () => {
    // User holds at 15%, but two frames mid-hold drop to 0 (MediaPipe glitch).
    // 8-frame HEEL_DROP_MIN_FRAMES confirmation should absorb a two-frame blip.
    const TOTAL_MS = CAL_MS + RISE_MS + 6000;
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) return { heelRisePct: 0 };
        const t = tMs - CAL_MS;
        if (t < RISE_MS) return { heelRisePct: (t / RISE_MS) * 15 };
        if (t < 4000) return { heelRisePct: 15 };
        // Two-frame outlier dropout at t = ~4000ms.
        if (t < 4067) return { heelRisePct: 0 };
        return { heelRisePct: 15 };
      },
      buildCalfRaisePose,
      { fps: 30, durationMs: TOTAL_MS },
    );

    const result = runCalfRaiseSession(frames);
    const drops = result.warnings.filter((w) => w.type === 'heel-dropped').length;
    expect(drops).toBe(0);
  });
});
