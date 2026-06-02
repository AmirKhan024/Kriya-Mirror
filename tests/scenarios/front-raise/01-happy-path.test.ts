import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildFrontRaisePose } from '../../harness/pose-stub';
import { runFrontRaiseSession, warningsOtherThan } from '../../harness/runner';

// 2026-05-28 round 21: front-raise re-architected to FRONT camera.
// 2.2 s calibration at DOWN (arms at sides), then N reps. Each rep:
//   0–800 ms : raise 0 → 95° (peak yields measured ~115° via 2D angle helper,
//              within the 75-130° valid range)
//   800–1300 : hold at top
//   1300–2400: lower 95 → 0
//   2400–2800: rest at sides
function happyPathIntent(reps: number) {
  const calMs = 2200;
  const repCycleMs = 2800;
  const totalMs = calMs + reps * repCycleMs;
  return {
    totalMs,
    intentAt: (tMs: number) => {
      if (tMs < calMs) return { shoulderFlexionDeg: 0 };
      const tInRep = (tMs - calMs) % repCycleMs;
      let flex: number;
      if (tInRep < 800) flex = (tInRep / 800) * 95;
      else if (tInRep < 1300) flex = 95;
      else if (tInRep < 2400) flex = 95 - ((tInRep - 1300) / 1100) * 95;
      else flex = 0;
      return { shoulderFlexionDeg: flex };
    },
  };
}

describe('Front Raise — happy path', () => {
  it('calibrates within 2.2s and counts 10 perfect reps', () => {
    const { totalMs, intentAt } = happyPathIntent(10);
    const frames = buildFrames(intentAt, buildFrontRaisePose, { fps: 30, durationMs: totalMs });

    const result = runFrontRaiseSession(frames);

    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThanOrEqual(2300);
    expect(result.completedReps.length).toBe(10);
    expect(warningsOtherThan(result, 'not-moving').length).toBe(0);
    const avgMqs = result.completedReps.reduce((s, r) => s + r.mqs, 0) / result.completedReps.length;
    expect(avgMqs).toBeGreaterThanOrEqual(60);
  });

  it('counts 5 reps when given a 5-rep stream', () => {
    const { totalMs, intentAt } = happyPathIntent(5);
    const frames = buildFrames(intentAt, buildFrontRaisePose, { fps: 30, durationMs: totalMs });
    const result = runFrontRaiseSession(frames);
    expect(result.completedReps.length).toBe(5);
  });
});
