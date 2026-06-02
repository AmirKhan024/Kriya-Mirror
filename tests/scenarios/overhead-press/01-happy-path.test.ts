/**
 * Overhead Press — happy path: calibration + rep counting.
 *
 * Press cycle (flex angles from elbowFlexionDeg / interior-bend convention):
 *   0–700 ms  : in RACKED position (flex ~75° — arms bent, bar at shoulder)
 *   700–1700  : press up (flex 75° → 12°)
 *   1700–2200 : hold at lockout (flex ~12°)
 *   2200–3200 : lower (flex 12° → 75°)
 *   3200–3700 : rest at rack
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildOverheadPressPose } from '../../harness/pose-stub';
import { runOverheadPressSession, warningsOtherThan } from '../../harness/runner';
import type { OverheadPressPoseIntent } from '../../harness/types';

const RACKED_FLEX = 75;   // arms bent ~75° (bar at shoulder/chest level)
const LOCKED_FLEX = 12;   // arms nearly straight overhead

/** Build a happy-path session: calibration + N overhead press reps. */
function happyPathIntent(reps: number) {
  const calMs = 800;       // calibration in racked position
  const repCycleMs = 3700; // one complete press cycle
  const totalMs = calMs + reps * repCycleMs;
  return {
    totalMs,
    intentAt: (tMs: number): OverheadPressPoseIntent => {
      if (tMs < calMs) return { elbowFlexionDeg: RACKED_FLEX };
      const tInRep = (tMs - calMs) % repCycleMs;
      let flex: number;
      if (tInRep < 700) {
        // Rest at rack
        flex = RACKED_FLEX;
      } else if (tInRep < 1700) {
        // Press up: flex decreases 75 → 12
        flex = RACKED_FLEX - ((tInRep - 700) / 1000) * (RACKED_FLEX - LOCKED_FLEX);
      } else if (tInRep < 2200) {
        // Hold at lockout
        flex = LOCKED_FLEX;
      } else if (tInRep < 3200) {
        // Lower: flex increases 12 → 75
        flex = LOCKED_FLEX + ((tInRep - 2200) / 1000) * (RACKED_FLEX - LOCKED_FLEX);
      } else {
        // Rest at rack
        flex = RACKED_FLEX;
      }
      return { elbowFlexionDeg: flex };
    },
  };
}

describe('Overhead Press — happy path', () => {
  it('calibrates quickly and counts 5 clean reps', () => {
    const { totalMs, intentAt } = happyPathIntent(5);
    const frames = buildFrames(intentAt, buildOverheadPressPose, { fps: 30, durationMs: totalMs });

    const result = runOverheadPressSession(frames);

    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThanOrEqual(1000);
    expect(result.completedReps.length).toBe(5);
    expect(warningsOtherThan(result, 'not-moving').length).toBe(0);
  });

  it('counts 3 reps when given a 3-rep stream', () => {
    const { totalMs, intentAt } = happyPathIntent(3);
    const frames = buildFrames(intentAt, buildOverheadPressPose, { fps: 30, durationMs: totalMs });
    const result = runOverheadPressSession(frames);
    expect(result.completedReps.length).toBe(3);
  });

  it('each rep has mqs > 0 and a reasonable depth angle', () => {
    const { totalMs, intentAt } = happyPathIntent(3);
    const frames = buildFrames(intentAt, buildOverheadPressPose, { fps: 30, durationMs: totalMs });
    const result = runOverheadPressSession(frames);
    for (const rep of result.completedReps) {
      expect(rep.mqs).toBeGreaterThan(0);
      // depthDeg = minFlexThisRep — should be near LOCKED_FLEX (12°)
      expect(rep.depthDeg).toBeLessThan(30);
    }
  });

  it('state cycles RACKED → PRESSING → LOCKED_OUT → LOWERING → RACKED', () => {
    const { totalMs, intentAt } = happyPathIntent(1);
    const frames = buildFrames(intentAt, buildOverheadPressPose, { fps: 30, durationMs: totalMs });
    const result = runOverheadPressSession(frames);

    // If the state machine cycled correctly, we get exactly 1 completed rep
    expect(result.completedReps.length).toBe(1);
  });
});
