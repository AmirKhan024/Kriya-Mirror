/**
 * Regression test for Fix A on Dead Bug: posture warnings ('hip-lift-off')
 * must NOT fire while the user is in AT_REST state between reps.
 *
 * Without Fix A, a sustained hipLiftAmount past HIP_LIFT_THRESHOLD (0.04) at
 * rest would spam 'hip-lift-off' every ~2.5s — the same bug squat had with
 * heel-lift / valgus during long pauses.
 *
 * Fix (engine.ts): gate `maybeEmitWarning('hip-lift-off')` to
 * `repState !== 'AT_REST'`. Tracking-validity signals ('not-moving') and
 * rep-rejection signals ('incomplete-dead-bug' / 'malformed-rep') stay ungated.
 *
 * This test holds the user in AT_REST with bad hip alignment for 5 seconds
 * and asserts ZERO 'hip-lift-off' warnings. A second test then runs a real
 * rep with the same bad signal during EXTENDING and asserts warnings DO fire.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildDeadBugPose } from '../../harness/pose-stub';
import { runDeadBugSession, countWarnings } from '../../harness/runner';
import type { DeadBugPoseIntent } from '../../harness/types';

// Fix G: calibration confirms after 200ms. 300ms at 30fps → instant confirm.
const CAL_MS = 300;

describe('Dead Bug — posture warning gating (only fire during active rep)', () => {
  it('does NOT fire hip-lift-off while user holds AT_REST idle with bad hip alignment', () => {
    // After calibration: legExtensionDeg stays at 0 (AT_REST) for 5 full seconds.
    // hipLiftAmount = 0.05 — past the HIP_LIFT_THRESHOLD=0.04.
    // Pre-Fix A: would spam 'hip-lift-off' every ~2.5s.
    // Post-Fix A: zero emissions because repState === 'AT_REST'.
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) {
          // Clean calibration pose — no hip lift during calibration
          return { legExtensionDeg: 0, armsUp: true } as DeadBugPoseIntent;
        }
        // Post-cal: stuck at AT_REST with persistently raised hips
        return {
          legExtensionDeg: 0,
          armsUp: true,
          hipLiftAmount: 0.05,  // past HIP_LIFT_THRESHOLD=0.04
        } as DeadBugPoseIntent;
      },
      buildDeadBugPose,
      { fps: 30, durationMs: CAL_MS + 5000 },
    );

    const result = runDeadBugSession(frames);

    expect(countWarnings(result, 'hip-lift-off')).toBe(0);
  });

  it('DOES fire hip-lift-off once user enters EXTENDING with bad hip alignment', () => {
    // Same bad hip signal — but now appearing only during the active extension
    // phase of a real rep. Engine should emit the warning as expected.
    const repCycleMs = 2500;
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) {
          return { legExtensionDeg: 0, armsUp: true } as DeadBugPoseIntent;
        }
        const tInRep = (tMs - CAL_MS) % repCycleMs;
        let ext: number;
        if (tInRep < 800)  ext = (tInRep / 800) * 60;
        else if (tInRep < 1200) ext = 60;
        else if (tInRep < 2000) ext = 60 - ((tInRep - 1200) / 800) * 60;
        else ext = 0;

        // Hip lift ONLY while extending past the EXTEND_START_DEG threshold (~15°)
        const inActivePhase = ext > 20;
        return {
          legExtensionDeg: ext,
          armsUp: true,
          hipLiftAmount: inActivePhase ? 0.05 : 0,
        } as DeadBugPoseIntent;
      },
      buildDeadBugPose,
      { fps: 30, durationMs: CAL_MS + 3 * repCycleMs },
    );

    const result = runDeadBugSession(frames);

    expect(countWarnings(result, 'hip-lift-off')).toBeGreaterThan(0);
  });
});
