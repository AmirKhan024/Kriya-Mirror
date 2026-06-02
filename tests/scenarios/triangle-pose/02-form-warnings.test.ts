/**
 * Triangle Pose's three form warnings. All recoverable per Fix S — they
 * freeze the timer, fire a warning, but do NOT terminate the workout.
 *
 * Warnings exercised:
 *   1. leg-not-straight       (either knee bending past 25°)
 *   2. top-arm-not-vertical   (top arm tilting > 20° from vertical)
 *   3. bottom-arm-not-down    (bottom-arm wrist Y lifted > 15% body-height
 *                              above the front-ankle Y)
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildTrianglePosePose } from '../../harness/pose-stub';
import { runTrianglePoseSession, countWarnings } from '../../harness/runner';
import type { TrianglePosePoseIntent } from '../../harness/types';

const CAL_MS = 2200;
const HOLD_START = CAL_MS;

describe('Triangle Pose — form warnings (Fix S recoverable)', () => {
  it('fires leg-not-straight when the front knee bends past 25°', () => {
    const frames = buildFrames(
      (tMs): TrianglePosePoseIntent => {
        const intoHold = tMs - HOLD_START;
        const flex = intoHold < 5000 ? 5 : 40;
        return { frontKneeFlexionDeg: flex };
      },
      buildTrianglePosePose,
      { fps: 30, durationMs: HOLD_START + 8000 },
    );
    const result = runTrianglePoseSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'leg-not-straight')).toBeGreaterThan(0);
    expect(result.broken).toBe(false);
  });

  it('fires leg-not-straight when the back knee bends past 25°', () => {
    const frames = buildFrames(
      (tMs): TrianglePosePoseIntent => {
        const intoHold = tMs - HOLD_START;
        const flex = intoHold < 5000 ? 5 : 40;
        return { backKneeFlexionDeg: flex };
      },
      buildTrianglePosePose,
      { fps: 30, durationMs: HOLD_START + 8000 },
    );
    const result = runTrianglePoseSession(frames);
    expect(countWarnings(result, 'leg-not-straight')).toBeGreaterThan(0);
    expect(result.broken).toBe(false);
  });

  it('fires top-arm-not-vertical when the top arm tilts > 20° from vertical', () => {
    const frames = buildFrames(
      (tMs): TrianglePosePoseIntent => {
        const intoHold = tMs - HOLD_START;
        const tilt = intoHold < 5000 ? 0 : 40;
        return { topArmTiltDeg: tilt };
      },
      buildTrianglePosePose,
      { fps: 30, durationMs: HOLD_START + 8000 },
    );
    const result = runTrianglePoseSession(frames);
    expect(countWarnings(result, 'top-arm-not-vertical')).toBeGreaterThan(0);
    expect(result.broken).toBe(false);
  });

  it('fires bottom-arm-not-down when the bottom hand is lifted off the front ankle', () => {
    const frames = buildFrames(
      (tMs): TrianglePosePoseIntent => {
        const intoHold = tMs - HOLD_START;
        // lift = 0.40 of body height (well above the loosened 0.30 threshold).
        const lift = intoHold < 5000 ? 0 : 0.40;
        return { bottomArmLiftFromAnkle: lift };
      },
      buildTrianglePosePose,
      { fps: 30, durationMs: HOLD_START + 8000 },
    );
    const result = runTrianglePoseSession(frames);
    expect(countWarnings(result, 'bottom-arm-not-down')).toBeGreaterThan(0);
    expect(result.broken).toBe(false);
  });

  it('does NOT fire any form warning on clean continuous form (sanity)', () => {
    const frames = buildFrames(
      () => ({} as TrianglePosePoseIntent),
      buildTrianglePosePose,
      { fps: 30, durationMs: HOLD_START + 8000 },
    );
    const result = runTrianglePoseSession(frames);
    expect(countWarnings(result, 'leg-not-straight')).toBe(0);
    expect(countWarnings(result, 'top-arm-not-vertical')).toBe(0);
    expect(countWarnings(result, 'bottom-arm-not-down')).toBe(0);
  });
});
