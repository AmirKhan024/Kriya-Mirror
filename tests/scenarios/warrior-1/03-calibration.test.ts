/**
 * Calibration tests:
 *   - 4 gates pass on a clean Warrior I (Fix G instant confirm ~200 ms)
 *   - Narrow stance (no lunge) → fails feetWide (stance) gate
 *   - Both knees straight (no lunge posture) → fails feetWide gate
 *   - Arms NOT overhead → fails armsOverhead gate (the Warrior I signature)
 *   - Body height too small (too far from camera) → Fix X analog: too-far hint
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildWarriorOnePose } from '../../harness/pose-stub';
import { runWarriorOneSession } from '../../harness/runner';
import type { WarriorOnePoseIntent } from '../../harness/types';

describe('Warrior I — calibration', () => {
  it('confirms within ~400 ms when all gates pass (Fix G instant)', () => {
    const frames = buildFrames(
      () => ({ frontKneeFlexionDeg: 90, armsRaised: true } as WarriorOnePoseIntent),
      buildWarriorOnePose,
      { fps: 30, durationMs: 1500 },
    );
    const result = runWarriorOneSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThanOrEqual(400);
  });

  it('fails the stance gate when feet are too close together (no lunge)', () => {
    const frames = buildFrames(
      () => ({ frontKneeFlexionDeg: 90, stanceWidth: 0.10 } as WarriorOnePoseIntent),
      buildWarriorOnePose,
      { fps: 30, durationMs: 1500 },
    );
    const result = runWarriorOneSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.checks.feetWide).toBe(false);
  });

  it('fails the stance gate when front knee is too straight (no lunge posture)', () => {
    const frames = buildFrames(
      () => ({ frontKneeFlexionDeg: 5, backKneeFlexionDeg: 5 } as WarriorOnePoseIntent),
      buildWarriorOnePose,
      { fps: 30, durationMs: 1500 },
    );
    const result = runWarriorOneSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.checks.feetWide).toBe(false);
  });

  it('fails the armsOverhead gate when arms are down at the sides', () => {
    const frames = buildFrames(
      () => ({ frontKneeFlexionDeg: 90, armsRaised: false } as WarriorOnePoseIntent),
      buildWarriorOnePose,
      { fps: 30, durationMs: 1500 },
    );
    const result = runWarriorOneSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.checks.armsOverhead).toBe(false);
  });

  it('reports too-far when body height is below the floor (Fix X analog)', () => {
    const frames = buildFrames(
      () => ({
        frontKneeFlexionDeg: 90,
        shoulderRise: -0.35,   // shoulderY moves DOWN (closer to ankle) → bodyHeight shrinks
      } as WarriorOnePoseIntent),
      buildWarriorOnePose,
      { fps: 30, durationMs: 1500 },
    );
    const result = runWarriorOneSession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.distanceHint).toBe('too-far');
    expect(result.finalCalibration?.checks.distanceOk).toBe(false);
  });
});
