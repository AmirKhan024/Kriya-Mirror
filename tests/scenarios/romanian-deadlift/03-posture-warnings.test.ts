/**
 * Romanian Deadlift — posture warnings.
 * 1. rounded-back (rdl-back-rounded) fires when shoulder droops below hip during rep.
 * 2. excessive-knee-bend fires when knee angle increases > 20° from calibration baseline.
 * 3. Both are gated to active rep state only (Fix A).
 */
import { describe, it, expect } from 'vitest';
import { buildFrames, concatFrames } from '../../harness/frame-stream';
import { buildRomanianDeadliftPose } from '../../harness/pose-stub';
import { runRDLSession, countWarnings } from '../../harness/runner';
import type { RomanianDeadliftPoseIntent } from '../../harness/types';

function standingFrames(durationMs: number) {
  return buildFrames(
    (): RomanianDeadliftPoseIntent => ({ hipHingeDeg: 0, kneeAngleDeg: 15 }),
    buildRomanianDeadliftPose,
    { fps: 30, durationMs },
  );
}

describe('Romanian Deadlift — posture warnings', () => {
  it('fires rdl-back-rounded when shoulder droops below hip during rep', () => {
    const calFrames = standingFrames(1000);
    const repFrames = buildFrames(
      (tMs): RomanianDeadliftPoseIntent => {
        if (tMs < 1000) return { hipHingeDeg: (tMs / 1000) * 60, roundedBack: tMs > 300, kneeAngleDeg: 15 };
        if (tMs < 1500) return { hipHingeDeg: 60, roundedBack: true, kneeAngleDeg: 15 };
        return { hipHingeDeg: 60 - ((tMs - 1500) / 1000) * 60, roundedBack: tMs < 2000, kneeAngleDeg: 15 };
      },
      buildRomanianDeadliftPose,
      { fps: 30, durationMs: 3500 },
    );
    const frames = concatFrames(calFrames, repFrames);
    const result = runRDLSession(frames);

    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'rdl-back-rounded')).toBeGreaterThan(0);
  });

  it('does NOT fire rdl-back-rounded when form is correct', () => {
    const calFrames = standingFrames(1000);
    const repFrames = buildFrames(
      (tMs): RomanianDeadliftPoseIntent => {
        if (tMs < 1000) return { hipHingeDeg: (tMs / 1000) * 65, kneeAngleDeg: 15 };
        if (tMs < 1500) return { hipHingeDeg: 65, kneeAngleDeg: 15 };
        return { hipHingeDeg: 65 - ((tMs - 1500) / 1000) * 65, kneeAngleDeg: 15 };
      },
      buildRomanianDeadliftPose,
      { fps: 30, durationMs: 3500 },
    );
    const frames = concatFrames(calFrames, repFrames);
    const result = runRDLSession(frames);

    expect(countWarnings(result, 'rdl-back-rounded')).toBe(0);
  });

  it('fires excessive-knee-bend when knee angle increases > 20° from baseline during rep', () => {
    const calFrames = standingFrames(1000);
    // Calibration captures kneeAngleDeg ~15°. During rep, add 30° extra bend → triggers warning.
    const repFrames = buildFrames(
      (tMs): RomanianDeadliftPoseIntent => {
        if (tMs < 1000) return { hipHingeDeg: (tMs / 1000) * 60, kneeAngleDeg: 15, extraKneeBend: tMs > 400 ? 30 : 0 };
        if (tMs < 1500) return { hipHingeDeg: 60, kneeAngleDeg: 15, extraKneeBend: 30 };
        return { hipHingeDeg: 60 - ((tMs - 1500) / 1000) * 60, kneeAngleDeg: 15, extraKneeBend: 30 };
      },
      buildRomanianDeadliftPose,
      { fps: 30, durationMs: 3500 },
    );
    const frames = concatFrames(calFrames, repFrames);
    const result = runRDLSession(frames);

    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'excessive-knee-bend')).toBeGreaterThan(0);
  });

  it('does NOT fire excessive-knee-bend when knees stay soft and constant', () => {
    const calFrames = standingFrames(1000);
    const repFrames = buildFrames(
      (tMs): RomanianDeadliftPoseIntent => {
        if (tMs < 1000) return { hipHingeDeg: (tMs / 1000) * 65, kneeAngleDeg: 15, extraKneeBend: 0 };
        if (tMs < 1500) return { hipHingeDeg: 65, kneeAngleDeg: 15, extraKneeBend: 0 };
        return { hipHingeDeg: 65 - ((tMs - 1500) / 1000) * 65, kneeAngleDeg: 15, extraKneeBend: 0 };
      },
      buildRomanianDeadliftPose,
      { fps: 30, durationMs: 3500 },
    );
    const frames = concatFrames(calFrames, repFrames);
    const result = runRDLSession(frames);

    expect(countWarnings(result, 'excessive-knee-bend')).toBe(0);
  });
});
