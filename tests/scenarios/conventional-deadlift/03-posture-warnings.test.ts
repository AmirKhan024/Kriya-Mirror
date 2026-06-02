/**
 * Conventional Deadlift — posture warnings.
 * Tests rounded-back detection during active rep phase.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames, concatFrames } from '../../harness/frame-stream';
import { buildDeadliftPose } from '../../harness/pose-stub';
import { runDeadliftSession, countWarnings } from '../../harness/runner';
import type { DeadliftPoseIntent } from '../../harness/types';

function standingFrames(durationMs: number) {
  return buildFrames(
    (): DeadliftPoseIntent => ({ hipHingeDeg: 0, armsAtSides: true }),
    buildDeadliftPose,
    { fps: 30, durationMs },
  );
}

describe('Conventional Deadlift — posture warnings', () => {
  it('fires rounded-back warning when shoulder droops below hip during rep', () => {
    // 1s calibration → descend with rounded back for 1.5s → hold → extend
    const calFrames = standingFrames(1000);
    const repFrames = buildFrames(
      (tMs): DeadliftPoseIntent => {
        if (tMs < 1000) return { hipHingeDeg: (tMs / 1000) * 70, roundedBack: tMs > 300 };
        if (tMs < 1500) return { hipHingeDeg: 70, roundedBack: true };
        return { hipHingeDeg: 70 - ((tMs - 1500) / 1000) * 70, roundedBack: tMs < 2000 };
      },
      buildDeadliftPose,
      { fps: 30, durationMs: 3500 },
    );
    const frames = concatFrames(calFrames, repFrames);
    const result = runDeadliftSession(frames);

    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'rounded-back')).toBeGreaterThan(0);
  });

  it('does NOT fire rounded-back when form is correct (shoulder above hip)', () => {
    const calFrames = standingFrames(1000);
    const repFrames = buildFrames(
      (tMs): DeadliftPoseIntent => {
        if (tMs < 1000) return { hipHingeDeg: (tMs / 1000) * 80 };
        if (tMs < 1500) return { hipHingeDeg: 80 };
        return { hipHingeDeg: 80 - ((tMs - 1500) / 1000) * 80 };
      },
      buildDeadliftPose,
      { fps: 30, durationMs: 3500 },
    );
    const frames = concatFrames(calFrames, repFrames);
    const result = runDeadliftSession(frames);

    expect(countWarnings(result, 'rounded-back')).toBe(0);
  });

  it('fires hips-shooting-up when hip rises much faster than shoulder during extension', () => {
    // Slow 2000ms descent lets EMA settle at peak. 700ms hold gets AT_BOTTOM.
    // hipYOffset only applied after extMs=600ms — safely after EXTENDING is entered
    // (~500ms in, when EMA smoothed has dropped 10° from peak). This avoids the
    // geometric artifact where hipYOffset at high hinge angles raises the computed
    // hinge and blocks the AT_BOTTOM→EXTENDING transition.
    const calFrames = standingFrames(1000);
    const repFrames = buildFrames(
      (tMs): DeadliftPoseIntent => {
        if (tMs < 2000) return { hipHingeDeg: (tMs / 2000) * 70 };   // slow 0→70°
        if (tMs < 2700) return { hipHingeDeg: 70 };                    // hold → AT_BOTTOM
        const extMs = tMs - 2700;
        const hinge = Math.max(0, 70 - (extMs / 1500) * 70);
        // hipYOffset starts at extMs=600ms (after EXTENDING entry). Hip rises faster
        // than shoulder → condition: hipDeltaY(-0.004/frame) << shoulderDeltaY(-0.002/frame)
        const hipYOffset = extMs > 600 ? -(extMs - 600) / 8000 : 0;
        return { hipHingeDeg: hinge, hipYOffset };
      },
      buildDeadliftPose,
      { fps: 30, durationMs: 3800 },
    );
    const frames = concatFrames(calFrames, repFrames);
    const result = runDeadliftSession(frames);

    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'hips-shooting-up')).toBeGreaterThan(0);
  });
});
