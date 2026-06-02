import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildSupermanPose } from '../../harness/pose-stub';
import { runSupermanSession, countWarnings } from '../../harness/runner';
import type { SupermanPoseIntent } from '../../harness/types';

// Fix G: calibration confirms after 200ms. 300ms at 30fps → instant confirm.
const CAL_MS = 300;

/**
 * Build frames with calibration phase followed by active rep cycles.
 */
function makeFrames(
  formCurve: (tInRep: number) => Partial<SupermanPoseIntent>,
  reps = 3,
  repCycleMs = 2500,
): ReturnType<typeof buildFrames> {
  return buildFrames(
    (tMs) => {
      if (tMs < CAL_MS) {
        return { shoulderRise: 0, armsForward: true } as SupermanPoseIntent;
      }
      const tInRep = (tMs - CAL_MS) % repCycleMs;
      return {
        shoulderRise: 0,
        armsForward: true,
        ...formCurve(tInRep),
      } as SupermanPoseIntent;
    },
    buildSupermanPose,
    { fps: 30, durationMs: CAL_MS + reps * repCycleMs + 300 },
  );
}

/** Standard rep rise curve: 0→0.08→0.08→0 over repCycleMs (default 2500ms). */
function repRise(t: number, peak = 0.08): number {
  if (t < 800)  return (t / 800) * peak;
  if (t < 1200) return peak;
  if (t < 2000) return peak - ((t - 1200) / 800) * peak;
  return 0;
}

describe('Superman — posture warnings', () => {
  it('fires hip-lift-off when hips rise > 0.04 for 10+ frames during active rep', () => {
    // hipLiftOff = 0.05 (past HIP_LIFT_THRESHOLD=0.04) injected through
    // the active extension phase. 10 sustained frames exceeds the 6-frame
    // debounce — engine must emit 'hip-lift-off'.
    const frames = makeFrames((t) => {
      const rise = repRise(t);
      // Inject hip lift only while actively rising
      const hipLiftOff = rise > 0.04 ? 0.05 : 0;
      return { shoulderRise: rise, hipLiftOff };
    }, 3);
    const result = runSupermanSession(frames);
    expect(countWarnings(result, 'hip-lift-off')).toBeGreaterThan(0);
  });

  it('does NOT fire hip-lift-off when lift is below threshold (hipLiftOff = 0.01)', () => {
    // 0.01 is well below HIP_LIFT_THRESHOLD=0.04 — no warning expected.
    const frames = makeFrames((t) => ({
      shoulderRise: repRise(t),
      hipLiftOff: 0.01,
    }), 3);
    const result = runSupermanSession(frames);
    expect(countWarnings(result, 'hip-lift-off')).toBe(0);
  });

  it('does NOT fire hip-lift-off for a brief 3-frame lift (below 6-frame debounce)', () => {
    // hipLiftOff = 0.05 only for ~3 frames (~100ms) during the active phase.
    // The HIP_LIFT_DEBOUNCE_FRAMES=6 gate suppresses this transient.
    const frames = makeFrames((t) => {
      const rise = repRise(t);
      // Only inject for a very narrow 100ms window
      const hipLiftOff = t >= 900 && t <= 1000 ? 0.05 : 0;
      return { shoulderRise: rise, hipLiftOff };
    }, 2);
    const result = runSupermanSession(frames);
    expect(countWarnings(result, 'hip-lift-off')).toBe(0);
  });

  it('does NOT fire hip-lift-off when user is at AT_REST (Fix A — warning gated to active rep)', () => {
    // hipLiftOff = 0.05 but shoulderRise stays at 0 (AT_REST throughout).
    // Fix A gates 'hip-lift-off' to active rep phases only — no reps means no warnings.
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) {
          return { shoulderRise: 0, armsForward: true } as SupermanPoseIntent;
        }
        // Post-cal: always at rest with persistent hip lift
        return {
          shoulderRise: 0,
          armsForward: true,
          hipLiftOff: 0.05,
        } as SupermanPoseIntent;
      },
      buildSupermanPose,
      { fps: 30, durationMs: CAL_MS + 5000 },
    );
    const result = runSupermanSession(frames);
    expect(countWarnings(result, 'hip-lift-off')).toBe(0);
  });

  it('does NOT fire any posture warnings on a clean rep (sanity check)', () => {
    const frames = makeFrames((t) => ({
      shoulderRise: repRise(t),
      hipLiftOff: 0,
    }), 3);
    const result = runSupermanSession(frames);
    expect(countWarnings(result, 'hip-lift-off')).toBe(0);
    expect(countWarnings(result, 'incomplete-superman')).toBe(0);
    expect(countWarnings(result, 'malformed-rep')).toBe(0);
  });
});
