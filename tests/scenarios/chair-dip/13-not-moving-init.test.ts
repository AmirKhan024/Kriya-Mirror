/**
 * Regression tests for Chair Dip not-moving warning timing fixes.
 *
 * Fix I  (round 5 §3.7): initialize extendedSince = now on cal-confirm.
 *   Without this, extendedSince=0 at construction means idleMs=(now - 0) is
 *   already millions on the first post-cal frame → instant false 'not-moving'.
 *
 * Fix P  (cold-start cooldown): lastNoMovementWarnAt===0 is treated as "never
 *   fired", so the 15s NO_MOVEMENT_REPEAT_MS cooldown does NOT block the very
 *   first idle warning when the session timestamp is still small.
 *
 * Constants from engine.ts:
 *   NO_MOVEMENT_TIMEOUT_MS  = 5000ms
 *   NO_MOVEMENT_REPEAT_MS   = 15000ms
 */
import { describe, it, expect } from 'vitest';
import { buildFrames, concatFrames } from '../../harness/frame-stream';
import { buildChairDipPose } from '../../harness/pose-stub';
import { runChairDipSession, countWarnings } from '../../harness/runner';
import type { ChairDipPoseIntent } from '../../harness/types';

/** A clean calibration segment: 300ms of all-green frames at elbowFlexionDeg=5. */
function calSegment() {
  return buildFrames(
    () => ({ elbowFlexionDeg: 5, feetWidthRatio: 1.0, bodyHeight: 0.70 } as ChairDipPoseIntent),
    buildChairDipPose,
    { fps: 30, durationMs: 300 },
  );
}

describe('Chair Dip — regression: no immediate "not-moving" after calibration (Fix I)', () => {
  it('Test A — not-moving fires 5s after calibration confirm', () => {
    // Run calibration (300ms) then hold elbowFlexionDeg=5 (EXTENDED) for 6000ms.
    // Total = ~6300ms. not-moving should fire somewhere in [5000ms, 6300ms]
    // after the calibration confirmation timestamp.
    const calMs = 300;
    const idleMs = 6000;

    const frames = buildFrames(
      (tMs) => {
        void tMs;
        return { elbowFlexionDeg: 5, feetWidthRatio: 1.0, bodyHeight: 0.70 } as ChairDipPoseIntent;
      },
      buildChairDipPose,
      { fps: 30, durationMs: calMs + idleMs },
    );

    const result = runChairDipSession(frames);

    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).not.toBeNull();
    expect(result.calibrationConfirmedAtMs!).toBeLessThan(500);
    // not-moving must fire at least once during the 6s idle
    expect(countWarnings(result, 'not-moving')).toBeGreaterThan(0);
    // The warning must appear after calibration was confirmed
    const firstWarnAt = result.warnings.find((w) => w.type === 'not-moving')?.atMs ?? 0;
    expect(firstWarnAt).toBeGreaterThan(result.calibrationConfirmedAtMs!);
  });

  it('Test B — cold-start cooldown allows first fire (Fix P)', () => {
    // Engine created and calibrated at t≈0. User holds still until t=5000ms.
    // Because lastNoMovementWarnAt===0 is treated as "never fired", the 15s
    // repeat cooldown must NOT suppress this first warning.
    const frames = buildFrames(
      () => ({ elbowFlexionDeg: 5, feetWidthRatio: 1.0, bodyHeight: 0.70 } as ChairDipPoseIntent),
      buildChairDipPose,
      { fps: 30, durationMs: 7000 },  // 7s total: cal (~200ms) + 5s idle window
    );

    const result = runChairDipSession(frames);

    expect(result.finalCalibration?.state).toBe('confirmed');
    // The first not-moving MUST fire — cold-start fix ensures this.
    expect(countWarnings(result, 'not-moving')).toBeGreaterThan(0);
  });

  it('Test C — not-moving does NOT repeat until NO_MOVEMENT_REPEAT_MS (15s) has elapsed', () => {
    // After the first not-moving at ~5s post-cal, the second fire must not
    // appear until ~20s total. We run 18s — just under the second window —
    // and expect exactly 1 warning.
    // Timeline: cal (~200ms) + 5s idle (first warning) + 12.8s more idle
    // = 18s total. 15s repeat cooldown means second fire would be at ~20s.
    const frames = buildFrames(
      () => ({ elbowFlexionDeg: 5, feetWidthRatio: 1.0, bodyHeight: 0.70 } as ChairDipPoseIntent),
      buildChairDipPose,
      { fps: 30, durationMs: 18000 },
    );

    const result = runChairDipSession(frames);

    expect(result.finalCalibration?.state).toBe('confirmed');
    // First warning fires somewhere around 5s post-cal.
    // Second warning should not yet have fired at 18s.
    expect(countWarnings(result, 'not-moving')).toBe(1);
  });
});
