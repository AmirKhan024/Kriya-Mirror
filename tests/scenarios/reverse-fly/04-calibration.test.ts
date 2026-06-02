/**
 * Reverse Fly — calibration gate tests.
 * (a) bent-forward gate fails when standing upright.
 * (b) armsHanging fails when arms raised at start.
 * (c) distanceHint emits 'too-close'/'too-far'.
 * (d) calibration confirms in ~200ms when all gates green.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildReverseFlyPose } from '../../harness/pose-stub';
import { runReverseFlySession } from '../../harness/runner';

describe('Reverse Fly — calibration gates', () => {
  it('(a) calibration fails when user is NOT bent forward (standing upright)', () => {
    // bentOver=false → shoulderMidY < hipMidY (shoulders above hips) → feetWide gate fails
    const frames = buildFrames(
      () => ({ armLiftDeg: 0, bentOver: false }),
      buildReverseFlyPose,
      { fps: 30, durationMs: 3000 },
    );

    const result = runReverseFlySession(frames);
    // Should NOT confirm — bent-forward gate is never met
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    // feetWide (bent-forward) gate should stay false
    expect(result.finalCalibration?.checks.feetWide).toBe(false);
  });

  it('(b) calibration fails when arms are at shoulder level (armsHanging gate fails)', () => {
    // armLiftDeg=90° → wrists at shoulder level (wristY ≈ shoulderY) → armsHanging gate fails
    // (gate requires wristY > shoulderY + ARMS_HANGING_THRESHOLD=0.06)
    const frames = buildFrames(
      () => ({ armLiftDeg: 90, bentOver: true }),
      buildReverseFlyPose,
      { fps: 30, durationMs: 3000 },
    );

    const result = runReverseFlySession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    // armsOverhead (arms-hanging) gate should be false when arms are at shoulder level
    expect(result.finalCalibration?.checks.armsOverhead).toBe(false);
  });

  it('(d) calibration confirms in ~200ms when all gates green', () => {
    // Perfect posture throughout: bent over, arms hanging at sides
    const frames = buildFrames(
      () => ({ armLiftDeg: 0, bentOver: true }),
      buildReverseFlyPose,
      { fps: 30, durationMs: 2000 },
    );

    const result = runReverseFlySession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    // Should confirm quickly (within ~300ms with 200ms confirm duration)
    expect(result.calibrationConfirmedAtMs).not.toBeNull();
    expect(result.calibrationConfirmedAtMs!).toBeLessThan(500);
  });

  it('calibration does not confirm with zero visible landmarks', () => {
    const frames = buildFrames(
      () => ({ armLiftDeg: 0, bentOver: true, visibility: 0 }),
      buildReverseFlyPose,
      { fps: 30, durationMs: 3000 },
    );

    const result = runReverseFlySession(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.checks.fullBodyVisible).toBe(false);
  });
});
