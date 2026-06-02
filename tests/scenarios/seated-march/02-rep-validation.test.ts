/**
 * Rep validation (Fix B + Fix D): a knee that crosses the UP threshold but
 * peaks below MIN_REP_HEIGHT_PCT (28%) is a too-shallow rep — discarded, fires
 * `low-knee-lift`, and does NOT increment the rep count.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildSeatedMarchPose } from '../../harness/pose-stub';
import { runSeatedMarchSession, countWarnings } from '../../harness/runner';
import type { SeatedMarchPoseIntent } from '../../harness/types';

const CAL_MS = 1000;

describe('Seated March — rep validation', () => {
  it('discards a too-shallow lift and fires low-knee-lift', () => {
    // Left knee rises to ~26% (crosses HIGH=20 → enters LEFT_UP) but peaks below
    // MIN_REP_HEIGHT_PCT=28, then returns to rest.
    const frames = buildFrames(
      (tMs): SeatedMarchPoseIntent => {
        if (tMs < CAL_MS) return { leftKneeLiftPct: 0, rightKneeLiftPct: 0 };
        const t = tMs - CAL_MS;
        if (t < 400) return { leftKneeLiftPct: (t / 400) * 26, rightKneeLiftPct: 0 };
        if (t < 1200) return { leftKneeLiftPct: 26, rightKneeLiftPct: 0 };
        if (t < 1600) return { leftKneeLiftPct: 26 * (1 - (t - 1200) / 400), rightKneeLiftPct: 0 };
        return { leftKneeLiftPct: 0, rightKneeLiftPct: 0 };
      },
      buildSeatedMarchPose,
      { fps: 30, durationMs: CAL_MS + 2200 },
    );
    const result = runSeatedMarchSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'low-knee-lift')).toBeGreaterThan(0);
    expect(result.completedReps.length).toBe(0);
  });

  it('counts a full-depth lift as a valid rep', () => {
    const frames = buildFrames(
      (tMs): SeatedMarchPoseIntent => {
        if (tMs < CAL_MS) return { leftKneeLiftPct: 0, rightKneeLiftPct: 0 };
        const t = tMs - CAL_MS;
        if (t < 400) return { leftKneeLiftPct: (t / 400) * 55, rightKneeLiftPct: 0 };
        if (t < 1200) return { leftKneeLiftPct: 55, rightKneeLiftPct: 0 };
        if (t < 1600) return { leftKneeLiftPct: 55 * (1 - (t - 1200) / 400), rightKneeLiftPct: 0 };
        return { leftKneeLiftPct: 0, rightKneeLiftPct: 0 };
      },
      buildSeatedMarchPose,
      { fps: 30, durationMs: CAL_MS + 2200 },
    );
    const result = runSeatedMarchSession(frames);
    expect(result.completedReps.length).toBe(1);
    expect(result.completedReps[0].side).toBe('left');
    expect(countWarnings(result, 'low-knee-lift')).toBe(0);
  });
});
