/**
 * Rep validation:
 *   - A half-rise (started lifting off the chair but sat back down without
 *     standing — knee never extended below STAND_CONFIRM_DEG=25°) fires
 *     `incomplete-stand` and does NOT count.
 *   - A clean full stand-up counts.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildChairPosePose } from '../../harness/pose-stub';
import { runSitToStandSession, countWarnings } from '../../harness/runner';
import type { ChairPosePoseIntent } from '../../harness/types';

const CAL_MS = 2200;

describe('Sit-to-Stand — rep validation', () => {
  it('fires incomplete-stand on a half-rise that sits back down', () => {
    const frames = buildFrames(
      (tMs): ChairPosePoseIntent => {
        if (tMs < CAL_MS) return { kneeFlexionDeg: 90, side: 'left' };
        const t = tMs - CAL_MS;
        // Rise only to ~38° (enters RISING < 50° but never reaches 25°), then sit.
        let flex: number;
        if (t < 600) flex = 90 - (t / 600) * 52;       // 90 → 38
        else if (t < 1000) flex = 38;                   // hover (not standing)
        else if (t < 1600) flex = 38 + ((t - 1000) / 600) * 52; // 38 → 90
        else flex = 90;
        return { kneeFlexionDeg: flex, side: 'left' };
      },
      buildChairPosePose,
      { fps: 30, durationMs: CAL_MS + 2000 },
    );
    const result = runSitToStandSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.completedReps.length).toBe(0);
    expect(countWarnings(result, 'incomplete-stand')).toBeGreaterThan(0);
  });

  it('counts a clean full stand-up', () => {
    const frames = buildFrames(
      (tMs): ChairPosePoseIntent => {
        if (tMs < CAL_MS) return { kneeFlexionDeg: 90, side: 'left' };
        const t = tMs - CAL_MS;
        let flex: number;
        if (t < 800) flex = 90 - (t / 800) * 85;        // 90 → 5
        else if (t < 1300) flex = 5;                     // standing
        else flex = 5 + ((t - 1300) / 800) * 85;         // sit back
        return { kneeFlexionDeg: Math.min(90, flex), side: 'left' };
      },
      buildChairPosePose,
      { fps: 30, durationMs: CAL_MS + 2400 },
    );
    const result = runSitToStandSession(frames);
    expect(result.completedReps.length).toBe(1);
    expect(countWarnings(result, 'incomplete-stand')).toBe(0);
    expect(result.completedReps[0].depthDeg).toBeGreaterThanOrEqual(55);
  });
});
