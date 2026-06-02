import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildDeadBugPose } from '../../harness/pose-stub';
import { runDeadBugSession, countWarnings } from '../../harness/runner';
import type { DeadBugPoseIntent } from '../../harness/types';

// Fix G: calibration confirms after 200ms. 300ms at 30fps = ~9 frames → instant confirm.
const CAL_MS = 300;

/**
 * Helper: build a frame sequence with calibration phase followed by N rep cycles.
 *
 * extensionCurve(tInRep) → legExtensionDeg for that moment within the cycle.
 */
function makeFrames(
  extensionCurve: (tInRep: number) => number,
  reps = 3,
  repCycleMs = 2000,
): ReturnType<typeof buildFrames> {
  return buildFrames(
    (tMs) => {
      if (tMs < CAL_MS) {
        // Calibration pose: tabletop + arms up
        return { legExtensionDeg: 0, armsUp: true } as DeadBugPoseIntent;
      }
      const tInRep = (tMs - CAL_MS) % repCycleMs;
      return {
        legExtensionDeg: extensionCurve(tInRep),
        armsUp: true,
      } as DeadBugPoseIntent;
    },
    buildDeadBugPose,
    { fps: 30, durationMs: CAL_MS + reps * repCycleMs + 300 },
  );
}

describe('Dead Bug — rep validation gates', () => {
  it('rejects too-shallow reps (peak legExtensionDeg = 20, smoothedExtension well below MIN_REP_DEPTH=40)', () => {
    // Peak raw input is 20°. After EMA smoothing (alpha=0.15) the smoothed peak
    // stays in the 8–15° range — well below MIN_REP_DEPTH_DEG=40.
    // Engine should fire 'incomplete-dead-bug' and NOT count any reps.
    const frames = makeFrames(
      (t) => {
        if (t < 600)  return (t / 600) * 20;
        if (t < 1000) return 20;
        if (t < 1600) return 20 - ((t - 1000) / 600) * 20;
        return 0;
      },
      5,
      2000,
    );
    const result = runDeadBugSession(frames);
    expect(result.completedReps.length).toBe(0);
    expect(countWarnings(result, 'incomplete-dead-bug')).toBeGreaterThan(0);
  });

  it('rejects too-fast (ballistic) reps — full cycle in < 600ms', () => {
    // Full extend→return cycle in 400ms (200ms down, 200ms up).
    // MIN_REP_DURATION_MS = 600ms, so the engine fires 'malformed-rep' and rejects.
    const frames = makeFrames(
      (t) => {
        if (t < 200) return (t / 200) * 65;
        if (t < 400) return 65 - ((t - 200) / 200) * 65;
        return 0;
      },
      5,
      600,
    );
    const result = runDeadBugSession(frames);
    expect(result.completedReps.length).toBe(0);
    const rejectionWarnings =
      countWarnings(result, 'malformed-rep') + countWarnings(result, 'incomplete-dead-bug');
    expect(rejectionWarnings).toBeGreaterThan(0);
  });

  it('accepts a valid deep rep (legExtensionDeg = 60, adequate hold)', () => {
    // Smooth extension to 60°, hold briefly, smooth return — all within a
    // 2-second cycle. The engine should count 3 reps with no rejection warnings.
    const frames = makeFrames(
      (t) => {
        if (t < 700)  return (t / 700) * 60;
        if (t < 1100) return 60;
        if (t < 1800) return 60 - ((t - 1100) / 700) * 60;
        return 0;
      },
      3,
      2200,
    );
    const result = runDeadBugSession(frames);
    expect(result.completedReps.length).toBe(3);
    expect(countWarnings(result, 'incomplete-dead-bug')).toBe(0);
  });
});
