/**
 * Kettlebell Swing — rep validation.
 * Tests Fix B/P2-1: shallow hinge → malformed-rep (not incomplete-extension).
 * Tests Fix B: too fast → malformed-rep.
 * Tests P1-1: SNAPPING timeout (stopped short of lockout) → incomplete-extension.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildKBSwingPose } from '../../harness/pose-stub';
import { runKBSwingSession, countWarnings } from '../../harness/runner';
import type { KBSwingPoseIntent } from '../../harness/types';

const CAL_MS = 1000;

describe('Kettlebell Swing — rep validation', () => {
  it('shallow hinge (< 50°) fires malformed-rep and discards rep (P2-1 fix)', () => {
    // Shallow swing at 35° (below MIN_REP_DEPTH_DEG=50).
    // After P1-1/P2-1 fix: too-shallow is the first check in validateRepShape → malformed-rep.
    // incomplete-extension is now reserved for SNAPPING timeout (not reaching top lockout).
    const REP_CYCLE_MS = 3000;
    const TOTAL_MS = CAL_MS + 2 * REP_CYCLE_MS;
    const frames = buildFrames(
      (tMs): KBSwingPoseIntent => {
        if (tMs < CAL_MS) return { hipHingeDeg: 0 };
        const tInRep = (tMs - CAL_MS) % REP_CYCLE_MS;
        const hinge = tInRep < 1500 ? 35 : 0;
        return { hipHingeDeg: hinge };
      },
      buildKBSwingPose,
      { fps: 30, durationMs: TOTAL_MS },
    );

    const result = runKBSwingSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.completedReps.length).toBe(0);
    expect(countWarnings(result, 'malformed-rep')).toBeGreaterThanOrEqual(1);
  });

  it('fires malformed-rep when rep is too fast (< 400ms)', () => {
    const REP_CYCLE_MS = 200;
    const TOTAL_MS = 1000 + 8 * REP_CYCLE_MS;
    const frames = buildFrames(
      (tMs): KBSwingPoseIntent => {
        if (tMs < 1000) return { hipHingeDeg: 0 };
        const tInRep = (tMs - 1000) % REP_CYCLE_MS;
        const hinge = tInRep < 50 ? 70 : 0;
        return { hipHingeDeg: hinge };
      },
      buildKBSwingPose,
      { fps: 60, durationMs: TOTAL_MS },
    );

    const result = runKBSwingSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.completedReps.length).toBe(0);
    const rejectionWarnings = result.warnings.filter(
      (w) => w.type === 'malformed-rep' || w.type === 'incomplete-extension',
    );
    expect(rejectionWarnings.length).toBeGreaterThanOrEqual(1);
  });

  it('fires incomplete-extension when user stops short of lockout in SNAPPING (P1-1)', () => {
    // Good hike to 65° (passes depth gate), then snaps to 20° and holds there.
    // 20° > HINGE_EXIT_DEG(15°) so the rep never closes normally.
    // After SNAPPING_TIMEOUT_MS(4000ms), the engine fires incomplete-extension and abandons rep.
    const STUCK_MS = 4500; // must exceed SNAPPING_TIMEOUT_MS=4000
    const TOTAL_MS = CAL_MS + 300 + 500 + 500 + STUCK_MS;
    const frames = buildFrames(
      (tMs): KBSwingPoseIntent => {
        if (tMs < CAL_MS) return { hipHingeDeg: 0 };
        const tRep = tMs - CAL_MS;
        if (tRep < 300) return { hipHingeDeg: 65 };   // hike to good bottom
        if (tRep < 800) return { hipHingeDeg: 65 };   // hold at bottom
        if (tRep < 1300) return { hipHingeDeg: 20 };  // snap but stop short (20° > HINGE_EXIT_DEG=15°)
        return { hipHingeDeg: 20 };                   // hold at 20° → triggers SNAPPING timeout
      },
      buildKBSwingPose,
      { fps: 30, durationMs: TOTAL_MS },
    );

    const result = runKBSwingSession(frames);
    // Rep abandoned — no reps counted
    expect(result.completedReps.length).toBe(0);
    // incomplete-extension fires via SNAPPING timeout
    expect(countWarnings(result, 'incomplete-extension')).toBeGreaterThanOrEqual(1);
  });
});
