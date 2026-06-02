/**
 * Regression test for engine bug A surfaced by Amir's 2026-05-25 physical test.
 *
 * Symptom (from console log):
 *   [CALIB] CONFIRMED (t=103748ms)
 *   [WARN] not-moving | {"idleMs":103755,"flexVariance":0} (t=103773ms)
 *
 * 25ms after calibration confirmed, the engine reported the user had been
 * idle for ~103 seconds and fired `not-moving`. Bug: `standingSince = 0` at
 * engine init, only reset on STANDING → another → STANDING transition, but
 * the engine STARTS in STANDING so it stays at 0 forever until first rep.
 *
 * Fix: initialize `standingSince = now` when calibration confirms.
 *
 * This test confirms zero `not-moving` warnings fire in the first 3 seconds
 * after calibration confirm (under the 5s NO_MOVEMENT_TIMEOUT_MS — was 8s
 * pre-round-5, now 5s per Amir's spec).
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildSquatPose } from '../../harness/pose-stub';
import { runSquatSession, countWarnings } from '../../harness/runner';
import type { SquatPoseIntent } from '../../harness/types';

describe('Squat — regression: no immediate "not-moving" after calibration (2026-05-25)', () => {
  it('does NOT fire not-moving within the first 3s after calibration confirms', () => {
    // Calibration now confirms in ~200ms (round-5 instant-confirm). Run 3
    // more seconds of stand-still. Total ~3.2s, under the 5s threshold.
    const frames = buildFrames(
      () => ({
        kneeFlexionDeg: 0,
        feetWidthRatio: 1.25,
        armsOverhead: true,
      } as SquatPoseIntent),
      buildSquatPose,
      { fps: 30, durationMs: 3200 },
    );

    const result = runSquatSession(frames);

    // Sanity: calibration confirmed
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThan(500);

    // The bug: pre-fix, not-moving fires within ~25ms of calibration confirm.
    // Post-fix: should not fire at all in this window.
    expect(countWarnings(result, 'not-moving')).toBe(0);
  });

  it('DOES fire not-moving after sustained idle past 5s post-calibration', () => {
    // Sanity check the other direction — idle for 8s should still trigger.
    const frames = buildFrames(
      () => ({
        kneeFlexionDeg: 0,
        feetWidthRatio: 1.25,
        armsOverhead: true,
      } as SquatPoseIntent),
      buildSquatPose,
      { fps: 30, durationMs: 8500 },
    );

    const result = runSquatSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'not-moving')).toBeGreaterThan(0);
  });
});
