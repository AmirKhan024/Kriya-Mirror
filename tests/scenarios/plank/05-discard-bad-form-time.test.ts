/**
 * Regression test for the "wrong gets discarded" feature added 2026-05-25
 * (round 3 of physical testing — mirror of squat's per-rep rejection).
 *
 * Before this change, the plank counter ticked wall-clock seconds. A user
 * who held for 30s but had hips visibly sagging for 12s still saw "30s"
 * on their hold counter. Now the counter freezes during sustained bad
 * form (hip-sag / hip-pike / spine-misaligned). Neck-droop is excluded —
 * it's a coaching cue, not a structural failure.
 *
 * "Sustained" = at least 6 frames (matches existing NO_FORM_OK_FRAMES
 * debounce). Brief sub-200ms wobbles do NOT deduct.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildPlankPose } from '../../harness/pose-stub';
import { runPlankSession } from '../../harness/runner';

// 2026-05-25 round 5: calibration now confirms in ~200ms (was 2200), so the
// engine accumulates an extra ~2s of valid hold from the CAL_MS padding window
// where the user is held in the calibration pose. Expectations adjusted.
const CAL_MS = 2200;

describe('Plank — discard bad-form time from hold counter (round 3)', () => {
  it('counts full hold (~12s) when form is clean throughout', () => {
    const frames = buildFrames(
      (tMs) => ({ hipDelta: 0, side: 'left' as const }),
      buildPlankPose,
      { fps: 30, durationMs: CAL_MS + 10000 },
    );
    const result = runPlankSession(frames);
    const lastTick = result.holdTicks[result.holdTicks.length - 1];
    expect(lastTick).toBeDefined();
    // Accumulator runs from ~200ms (instant confirm) to ~12200ms = ~12s.
    expect(lastTick.secondsElapsed).toBeGreaterThanOrEqual(11);
    expect(lastTick.secondsElapsed).toBeLessThanOrEqual(12);
  });

  it('freezes the counter during 4s of sustained hip-sag in the middle', () => {
    // 12s total valid window: ~2s pre-CAL_MS + 3s clean + 4s frozen + 3s clean = ~8s.
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) return { hipDelta: 0, side: 'left' as const };
        const tAfter = tMs - CAL_MS;
        const sagging = tAfter >= 3000 && tAfter < 7000;
        return { hipDelta: sagging ? 0.06 : 0, side: 'left' as const };
      },
      buildPlankPose,
      { fps: 30, durationMs: CAL_MS + 10000 },
    );
    const result = runPlankSession(frames);
    const lastTick = result.holdTicks[result.holdTicks.length - 1];
    expect(lastTick).toBeDefined();
    // ~8s of valid time. Slack for 6-frame debounce + EMA ramp on either edge.
    expect(lastTick.secondsElapsed).toBeGreaterThanOrEqual(7);
    expect(lastTick.secondsElapsed).toBeLessThanOrEqual(9);
  });

  it('does NOT deduct for a brief 100ms hip wobble (below debounce)', () => {
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) return { hipDelta: 0, side: 'left' as const };
        const tAfter = tMs - CAL_MS;
        const inWobble = tAfter >= 5000 && tAfter < 5100; // ~3 frames at 30fps
        return { hipDelta: inWobble ? 0.06 : 0, side: 'left' as const };
      },
      buildPlankPose,
      { fps: 30, durationMs: CAL_MS + 10000 },
    );
    const result = runPlankSession(frames);
    const lastTick = result.holdTicks[result.holdTicks.length - 1];
    expect(lastTick).toBeDefined();
    expect(lastTick.secondsElapsed).toBeGreaterThanOrEqual(11);
    expect(lastTick.secondsElapsed).toBeLessThanOrEqual(12);
  });

  it('does NOT deduct for sustained neck-droop (excluded from freeze list)', () => {
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) return { hipDelta: 0, side: 'left' as const };
        return { hipDelta: 0, neckDroop: 0.08, side: 'left' as const };
      },
      buildPlankPose,
      { fps: 30, durationMs: CAL_MS + 10000 },
    );
    const result = runPlankSession(frames);
    const lastTick = result.holdTicks[result.holdTicks.length - 1];
    expect(lastTick).toBeDefined();
    expect(lastTick.secondsElapsed).toBeGreaterThanOrEqual(11);
    expect(lastTick.secondsElapsed).toBeLessThanOrEqual(12);
  });
});
