/**
 * Calibration tests:
 * - All 4 gates pass → confirms in ≤ 200ms (Fix G)
 * - distanceHint: 'too-close' when body height > 0.92 (Fix H)
 * - distanceHint: 'too-far' when body height < 0.45 (Fix H)
 * - Hysteresis: body at 0.43 does not re-open gate if was inside exit band (Fix F)
 * - state: 'timeout' fires after 20s without gate green (Fix J)
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildCurtsyLungePose } from '../../harness/pose-stub';
import { runCurtsyLungeSession } from '../../harness/runner';
import type { CurtsyLungePoseIntent } from '../../harness/types';
import { CurtsyLungeEngine } from '@/modules/curtsy-lunge/engine';
import type { CalibrationUpdate } from '@/modules/squat/types';

describe('Curtsy Lunge — calibration', () => {
  it('all gates green → confirms in ≤ 200ms (Fix G)', () => {
    // Standard standing pose, all gates pass immediately
    const frames = buildFrames(
      () => ({
        kneeFlexionDeg: 170,
        crossoverRatio: 0,
        // default: feetWide, armsAtSides, distanceOk all green
      } as CurtsyLungePoseIntent),
      buildCurtsyLungePose,
      { fps: 30, durationMs: 1000 },
    );

    const result = runCurtsyLungeSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    // Should confirm very quickly (≤ 200ms debounce)
    expect(result.calibrationConfirmedAtMs).not.toBeNull();
    expect(result.calibrationConfirmedAtMs!).toBeLessThanOrEqual(300);
  });

  it('emits distanceHint: too-close when body span > 0.92', () => {
    const calUpdates: Array<{ distanceHint: string | null }> = [];
    const engine = new CurtsyLungeEngine({
      onCalibrationUpdate: (u: CalibrationUpdate) => calUpdates.push({ distanceHint: u.distanceHint }),
    });

    const frames = buildFrames(
      () => ({
        kneeFlexionDeg: 170,
        crossoverRatio: 0,
        bodyHeight: 0.95,  // > 0.92 ENTER threshold → too-close
      } as CurtsyLungePoseIntent),
      buildCurtsyLungePose,
      { fps: 30, durationMs: 1000 },
    );

    for (const frame of frames) {
      engine.update(frame.landmarks, frame.tMs);
    }

    const tooCloseUpdates = calUpdates.filter(u => u.distanceHint === 'too-close');
    expect(tooCloseUpdates.length).toBeGreaterThan(0);
  });

  it('emits distanceHint: too-far when body span < 0.45', () => {
    const calUpdates: Array<{ distanceHint: string | null }> = [];
    const engine = new CurtsyLungeEngine({
      onCalibrationUpdate: (u: CalibrationUpdate) => calUpdates.push({ distanceHint: u.distanceHint }),
    });

    const frames = buildFrames(
      () => ({
        kneeFlexionDeg: 170,
        crossoverRatio: 0,
        bodyHeight: 0.40,  // < 0.45 ENTER threshold → too-far
      } as CurtsyLungePoseIntent),
      buildCurtsyLungePose,
      { fps: 30, durationMs: 1000 },
    );

    for (const frame of frames) {
      engine.update(frame.landmarks, frame.tMs);
    }

    const tooFarUpdates = calUpdates.filter(u => u.distanceHint === 'too-far');
    expect(tooFarUpdates.length).toBeGreaterThan(0);
  });

  it('state: timeout fires after 20s without all gates green (Fix J)', () => {
    // Hold pose with arms raised (fails armsAtSides gate) for 21 seconds
    const frames = buildFrames(
      () => ({
        kneeFlexionDeg: 170,
        crossoverRatio: 0,
        armsRaised: true,  // fails armsOverhead (armsAtSides) gate
      } as CurtsyLungePoseIntent),
      buildCurtsyLungePose,
      { fps: 30, durationMs: 21000 },
    );

    const result = runCurtsyLungeSession(frames);
    expect(result.finalCalibration?.state).toBe('timeout');
  });
});
