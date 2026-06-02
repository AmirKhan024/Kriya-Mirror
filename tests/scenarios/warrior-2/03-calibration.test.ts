/**
 * Calibration tests:
 *   - 4 gates pass on a clean Warrior II (Fix G instant confirm ~200 ms)
 *   - Narrow stance (no lunge) → fails feetWide gate
 *   - Both knees straight (no warrior) → fails armsOverhead (posture-ready) gate
 *   - Body height too small (too far from camera) → Fix X analog: too-far hint
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildWarriorTwoPose } from '../../harness/pose-stub';
import { runWarriorTwoSession } from '../../harness/runner';
import type { WarriorTwoPoseIntent } from '../../harness/types';

describe('Warrior II — calibration', () => {
  it('confirms within ~400 ms when all gates pass (Fix G instant)', () => {
    const frames = buildFrames(
      () => ({ frontKneeFlexionDeg: 90 } as WarriorTwoPoseIntent),
      buildWarriorTwoPose,
      { fps: 30, durationMs: 1500 },
    );
    const result = runWarriorTwoSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThanOrEqual(400);
  });

  it('fails the stance gate when feet are too close together (no lunge)', () => {
    const frames = buildFrames(
      () => ({ frontKneeFlexionDeg: 90, stanceWidth: 0.10 } as WarriorTwoPoseIntent),
      buildWarriorTwoPose,
      { fps: 30, durationMs: 1500 },
    );
    const result = runWarriorTwoSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.checks.feetWide).toBe(false);
  });

  it('fails the posture-ready gate when front knee is too straight', () => {
    // Both knees ~5° flex — no Warrior II posture
    const frames = buildFrames(
      () => ({ frontKneeFlexionDeg: 5, backKneeFlexionDeg: 5 } as WarriorTwoPoseIntent),
      buildWarriorTwoPose,
      { fps: 30, durationMs: 1500 },
    );
    const result = runWarriorTwoSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.checks.armsOverhead).toBe(false);
  });

  it('reports too-far when body height is below the floor (Fix X analog)', () => {
    // bodyHeight via natural geometry — controlled via stanceWidth + flex.
    // To get a small overall body height, reduce frontKneeFlexion to 90° and
    // pass a small bodyHeight; the engine's distance check uses ankleY -
    // shoulderY span from landmarks (not the intent). Use shoulderRise to
    // shrink the visible span:
    const frames = buildFrames(
      () => ({
        frontKneeFlexionDeg: 90,
        shoulderRise: -0.35,   // shoulderY moves DOWN (closer to ankle) → bodyHeight shrinks
      } as WarriorTwoPoseIntent),
      buildWarriorTwoPose,
      { fps: 30, durationMs: 1500 },
    );
    const result = runWarriorTwoSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.distanceHint).toBe('too-far');
    expect(result.finalCalibration?.checks.distanceOk).toBe(false);
  });
});
