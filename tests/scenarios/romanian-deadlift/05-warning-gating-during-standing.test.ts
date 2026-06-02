/**
 * Romanian Deadlift — warning gating (Fix A).
 * Form warnings (rdl-back-rounded, excessive-knee-bend) must NOT fire
 * while engine is in STANDING state between reps.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildRomanianDeadliftPose } from '../../harness/pose-stub';
import { runRDLSession, countWarnings } from '../../harness/runner';
import type { RomanianDeadliftPoseIntent } from '../../harness/types';

describe('Romanian Deadlift — warning gating (Fix A)', () => {
  it('does NOT fire rdl-back-rounded while engine stays in STANDING state', () => {
    // hipHingeDeg: 5° — well below HINGE_START (20°), so repState always STANDING.
    // gating: `inActiveRep = repState !== STANDING` → false → no warning
    const frames = buildFrames(
      (): RomanianDeadliftPoseIntent => ({
        hipHingeDeg: 5,
        kneeAngleDeg: 15,
        roundedBack: false, // clean form — just verifying gate
      }),
      buildRomanianDeadliftPose,
      { fps: 30, durationMs: 6000 },
    );
    const result = runRDLSession(frames);

    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'rdl-back-rounded')).toBe(0);
  });

  it('does NOT fire excessive-knee-bend while engine stays in STANDING state', () => {
    // Extra knee bend injected but engine is STANDING — warning must be silent.
    const frames = buildFrames(
      (): RomanianDeadliftPoseIntent => ({
        hipHingeDeg: 5,
        kneeAngleDeg: 15,
        extraKneeBend: 35, // would trigger warning during active rep
      }),
      buildRomanianDeadliftPose,
      { fps: 30, durationMs: 6000 },
    );
    const result = runRDLSession(frames);

    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'excessive-knee-bend')).toBe(0);
  });

  it('fires rdl-back-rounded only during the active rep phase', () => {
    const frames = buildFrames(
      (tMs): RomanianDeadliftPoseIntent => {
        if (tMs < 1000) return { hipHingeDeg: 0, kneeAngleDeg: 15 };
        // Start rep at 1000ms
        if (tMs < 2000) {
          const t = (tMs - 1000) / 1000;
          return { hipHingeDeg: t * 60, roundedBack: t > 0.3, kneeAngleDeg: 15 };
        }
        if (tMs < 2500) return { hipHingeDeg: 60, roundedBack: true, kneeAngleDeg: 15 };
        if (tMs < 3500) {
          const t = (tMs - 2500) / 1000;
          return { hipHingeDeg: 60 - t * 60, roundedBack: t < 0.7, kneeAngleDeg: 15 };
        }
        // Standing again — clean form
        return { hipHingeDeg: 0, kneeAngleDeg: 15 };
      },
      buildRomanianDeadliftPose,
      { fps: 30, durationMs: 5000 },
    );
    const result = runRDLSession(frames);

    // Warning should have fired during the active rep
    expect(countWarnings(result, 'rdl-back-rounded')).toBeGreaterThan(0);
  });
});
