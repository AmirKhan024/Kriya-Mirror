import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildSupermanPose } from '../../harness/pose-stub';
import { runSupermanSession, countWarnings } from '../../harness/runner';
import type { SupermanPoseIntent } from '../../harness/types';

// Fix G: calibration confirms after 200ms. 300ms at 30fps = ~9 frames → instant confirm.
const CAL_MS = 300;

/**
 * Helper: build a frame sequence with calibration phase followed by N rep cycles.
 */
function makeFrames(
  riseCurve: (tInRep: number) => number,
  reps = 3,
  repCycleMs = 2000,
): ReturnType<typeof buildFrames> {
  return buildFrames(
    (tMs) => {
      if (tMs < CAL_MS) {
        return { shoulderRise: 0, armsForward: true } as SupermanPoseIntent;
      }
      const tInRep = (tMs - CAL_MS) % repCycleMs;
      return {
        shoulderRise: riseCurve(tInRep),
        armsForward: true,
      } as SupermanPoseIntent;
    },
    buildSupermanPose,
    { fps: 30, durationMs: CAL_MS + reps * repCycleMs + 300 },
  );
}

describe('Superman — rep validation gates', () => {
  it('rejects too-shallow reps (peak shoulderRise = 0.04, below MIN_SHOULDER_RISE=0.06)', () => {
    // Peak raw input is 0.04 — above RISE_ENTER_THRESHOLD=0.03 so RISING state is reached,
    // but below MIN_SHOULDER_RISE=0.06 so the rep is rejected as 'incomplete-superman'.
    const frames = makeFrames(
      (t) => {
        if (t < 600)  return (t / 600) * 0.04;
        if (t < 1000) return 0.04;
        if (t < 1600) return 0.04 - ((t - 1000) / 600) * 0.04;
        return 0;
      },
      5,
      2000,
    );
    const result = runSupermanSession(frames);
    expect(result.completedReps.length).toBe(0);
    expect(countWarnings(result, 'incomplete-superman')).toBeGreaterThan(0);
  });

  it('rejects too-fast (ballistic) reps — full cycle in < 400ms', () => {
    // Full rise→lower cycle in 300ms (150ms up, 150ms down).
    // MIN_REP_DURATION_MS = 400ms, so the engine fires 'malformed-rep' and rejects.
    const frames = makeFrames(
      (t) => {
        if (t < 150) return (t / 150) * 0.10;
        if (t < 300) return 0.10 - ((t - 150) / 150) * 0.10;
        return 0;
      },
      5,
      500,
    );
    const result = runSupermanSession(frames);
    expect(result.completedReps.length).toBe(0);
    const rejectionWarnings =
      countWarnings(result, 'malformed-rep') + countWarnings(result, 'incomplete-superman');
    expect(rejectionWarnings).toBeGreaterThan(0);
  });

  it('accepts a valid rep (shoulderRise = 0.08, adequate timing)', () => {
    // Smooth rise to 0.08, hold briefly, smooth lower — all within a 2-second cycle.
    const frames = makeFrames(
      (t) => {
        if (t < 700)  return (t / 700) * 0.08;
        if (t < 1100) return 0.08;
        if (t < 1800) return 0.08 - ((t - 1100) / 700) * 0.08;
        return 0;
      },
      3,
      2200,
    );
    const result = runSupermanSession(frames);
    expect(result.completedReps.length).toBeGreaterThanOrEqual(3);
    expect(countWarnings(result, 'incomplete-superman')).toBe(0);
  });
});
