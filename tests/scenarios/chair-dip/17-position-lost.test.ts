/**
 * Regression test for the round-6 cross-cutting `position-lost` warning
 * wired into Chair Dip. Mirrors bicep-curl/09-position-lost.test.ts and
 * lunge/17-position-lost.test.ts exactly (Fix N).
 *
 * Spec: if no usable pose frame (landmarks null OR core body landmarks
 * not visible) for >= 3 seconds post-calibration, the engine emits
 * `position-lost`. Repeats at most every 10s while still lost.
 *
 * Test A — position-lost fires after 3+ seconds of null landmarks post-cal.
 * Test B — position-lost repeats after another 10s while still lost.
 * Test C — position-lost does NOT fire if landmarks recover before 3s elapse.
 * Test D — clean tracking (all frames visible): NO position-lost at any time.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildChairDipPose } from '../../harness/pose-stub';
import { runChairDipSession, countWarnings } from '../../harness/runner';
import type { ChairDipPoseIntent } from '../../harness/types';

// Calibration requires feetWidthRatio=1.0 and bodyHeight=0.70.
// CONFIRM_DURATION_MS=200ms so 500ms is sufficient.
const CAL_MS = 500;

describe('Chair Dip — position-lost warning (Fix N)', () => {
  it('fires position-lost after 3+ seconds of null landmarks post-calibration', () => {
    // Calibrate for 500ms (clean pose), then return null landmarks for 4 s.
    // With POSITION_LOST_TIMEOUT_MS = 3000, the warning fires at t >= 3500ms.
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) {
          return { elbowFlexionDeg: 5, feetWidthRatio: 1.0, bodyHeight: 0.70 } as ChairDipPoseIntent;
        }
        // Post-cal: user stepped out — no usable frame.
        return null;
      },
      buildChairDipPose,
      { fps: 30, durationMs: CAL_MS + 4000 },
    );

    const result = runChairDipSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'position-lost')).toBeGreaterThan(0);
  });

  it('position-lost repeats after 10s while still lost', () => {
    // Calibrate, then null frames for 15 s.
    // First fire at ~3500ms, second fire at ~13500ms.
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) {
          return { elbowFlexionDeg: 5, feetWidthRatio: 1.0, bodyHeight: 0.70 } as ChairDipPoseIntent;
        }
        return null;
      },
      buildChairDipPose,
      { fps: 30, durationMs: CAL_MS + 15000 },
    );

    const result = runChairDipSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    // Should fire at least twice (at ~5.2s and ~15.2s)
    expect(countWarnings(result, 'position-lost')).toBeGreaterThanOrEqual(2);
  });

  it('does NOT fire position-lost if landmarks recover before 3 seconds', () => {
    // Null frames for 2900 ms post-cal (just under the 3 s threshold), then
    // one valid frame, then more null. The 3 s clock resets on the valid frame
    // so no warning should fire within the overall window.
    const RECOVERY_AT = CAL_MS + 2900;
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) {
          return { elbowFlexionDeg: 5, feetWidthRatio: 1.0, bodyHeight: 0.70 } as ChairDipPoseIntent;
        }
        if (tMs >= RECOVERY_AT && tMs < RECOVERY_AT + 100) {
          // Brief valid frame resets the position-lost clock
          return { elbowFlexionDeg: 5, feetWidthRatio: 1.0, bodyHeight: 0.70 } as ChairDipPoseIntent;
        }
        return null;
      },
      buildChairDipPose,
      { fps: 30, durationMs: CAL_MS + 5000 },
    );

    const result = runChairDipSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    // The valid frame resets the clock — no full 3 s gap occurs before the window ends
    expect(countWarnings(result, 'position-lost')).toBe(0);
  });

  it('does NOT fire position-lost on a clean continuous tracking stream', () => {
    // All frames valid throughout — no pose loss at all.
    const frames = buildFrames(
      () => ({ elbowFlexionDeg: 5, feetWidthRatio: 1.0, bodyHeight: 0.70 } as ChairDipPoseIntent),
      buildChairDipPose,
      { fps: 30, durationMs: 8000 },
    );

    const result = runChairDipSession(frames);
    expect(countWarnings(result, 'position-lost')).toBe(0);
  });
});
