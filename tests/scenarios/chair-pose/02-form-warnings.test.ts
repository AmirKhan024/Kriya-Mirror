/**
 * Form-warning emission tests. All three chair-pose warnings (knee-too-straight,
 * torso-too-forward, heel-lift) are RECOVERABLE per Fix S — they freeze the
 * hold counter, fire a warning, but do NOT terminate the workout.
 *
 * Each test mid-hold transitions from clean form → sustained bad form, then
 * verifies the corresponding warning fired and the workout is still alive.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildChairPosePose } from '../../harness/pose-stub';
import { runChairPoseSession, countWarnings } from '../../harness/runner';
import type { ChairPosePoseIntent } from '../../harness/types';

const CAL_MS = 2200;
const HOLD_START = CAL_MS;

describe('Chair Pose — form warnings (recoverable per Fix S)', () => {
  it('fires knee-too-straight when knees come up out of the hold', () => {
    const frames = buildFrames(
      (tMs): ChairPosePoseIntent => {
        // Clean form for the first 5s of the hold, then knees straighten.
        const intoHold = tMs - HOLD_START;
        const kneeFlex = intoHold < 5000 ? 90 : 25; // 25° = standing-ish (far below 50° threshold)
        return { kneeFlexionDeg: kneeFlex, side: 'left' };
      },
      buildChairPosePose,
      { fps: 30, durationMs: HOLD_START + 8000 },
    );
    const result = runChairPoseSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'knee-too-straight')).toBeGreaterThan(0);
    expect(result.broken).toBe(false); // recoverable, not terminal
  });

  it('fires torso-too-forward when the user leans far forward', () => {
    const frames = buildFrames(
      (tMs): ChairPosePoseIntent => {
        const intoHold = tMs - HOLD_START;
        const lean = intoHold < 5000 ? 5 : 45; // 45° = clearly leaning (> 30° threshold)
        return { kneeFlexionDeg: 90, trunkLeanDeg: lean, side: 'left' };
      },
      buildChairPosePose,
      { fps: 30, durationMs: HOLD_START + 8000 },
    );
    const result = runChairPoseSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'torso-too-forward')).toBeGreaterThan(0);
    expect(result.broken).toBe(false);
  });

  it('fires heel-lift when the user shifts forward onto their toes', () => {
    const frames = buildFrames(
      (tMs): ChairPosePoseIntent => {
        const intoHold = tMs - HOLD_START;
        const heelLift = intoHold < 5000 ? 0 : 0.07; // 0.07 well above 0.03 threshold
        return { kneeFlexionDeg: 90, heelLift, side: 'left' };
      },
      buildChairPosePose,
      { fps: 30, durationMs: HOLD_START + 8000 },
    );
    const result = runChairPoseSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'heel-lift')).toBeGreaterThan(0);
    expect(result.broken).toBe(false);
  });

  it('fires knee-too-deep when the user sinks into a full squat', () => {
    const frames = buildFrames(
      (tMs): ChairPosePoseIntent => {
        const intoHold = tMs - HOLD_START;
        // Clean 90° hold, then sink to 135° (well past the 120° threshold).
        const kneeFlex = intoHold < 5000 ? 90 : 135;
        return { kneeFlexionDeg: kneeFlex, side: 'left' };
      },
      buildChairPosePose,
      { fps: 30, durationMs: HOLD_START + 8000 },
    );
    const result = runChairPoseSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'knee-too-deep')).toBeGreaterThan(0);
    expect(result.broken).toBe(false); // recoverable, not terminal
  });

  it('does NOT fire any structural warning on clean continuous form', () => {
    const frames = buildFrames(
      () => ({ kneeFlexionDeg: 90, trunkLeanDeg: 8, side: 'left' as const } as ChairPosePoseIntent),
      buildChairPosePose,
      { fps: 30, durationMs: HOLD_START + 8000 },
    );
    const result = runChairPoseSession(frames);
    expect(countWarnings(result, 'knee-too-straight')).toBe(0);
    expect(countWarnings(result, 'knee-too-deep')).toBe(0);
    expect(countWarnings(result, 'torso-too-forward')).toBe(0);
    expect(countWarnings(result, 'heel-lift')).toBe(0);
  });
});
