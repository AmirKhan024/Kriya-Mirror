import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildJumpingJacksPose } from '../../harness/pose-stub';
import { runJumpingJacksSession, warningsOtherThan } from '../../harness/runner';

// 2.2 s calibration in CLOSED position, then N jacks. Each rep:
//   0–500 ms  : CLOSED → OPEN (arms + feet open together)
//   500–1000  : OPEN hold (arms overhead, feet wide)
//   1000–1500 : OPEN → CLOSED
//   1500–2000 : CLOSED rest
function happyPathIntent(reps: number) {
  const calMs = 2200;
  const repCycleMs = 2000;
  const totalMs = calMs + reps * repCycleMs;
  return {
    totalMs,
    intentAt: (tMs: number) => {
      if (tMs < calMs) return { armOpennessPct: 0, legOpennessPct: 30 };
      const tInRep = (tMs - calMs) % repCycleMs;
      let openness: number;
      if (tInRep < 500) openness = (tInRep / 500);
      else if (tInRep < 1000) openness = 1.0;
      else if (tInRep < 1500) openness = 1.0 - ((tInRep - 1000) / 500);
      else openness = 0;
      // Both axes open together; leg openness ranges 30 (closed) → 100 (open).
      const armPct = openness * 100;
      const legPct = 30 + openness * 70;
      return { armOpennessPct: armPct, legOpennessPct: legPct };
    },
  };
}

describe('Jumping Jacks — happy path', () => {
  it('calibrates within 2.2s and counts 10 perfect jacks', () => {
    const { totalMs, intentAt } = happyPathIntent(10);
    const frames = buildFrames(intentAt, buildJumpingJacksPose, { fps: 30, durationMs: totalMs });

    const result = runJumpingJacksSession(frames);

    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThanOrEqual(2300);
    expect(result.completedReps.length).toBe(10);
    expect(warningsOtherThan(result, 'not-moving').length).toBe(0);
    const avgMqs = result.completedReps.reduce((s, r) => s + r.mqs, 0) / result.completedReps.length;
    expect(avgMqs).toBeGreaterThanOrEqual(60);
  });

  it('counts 5 reps when given a 5-rep stream', () => {
    const { totalMs, intentAt } = happyPathIntent(5);
    const frames = buildFrames(intentAt, buildJumpingJacksPose, { fps: 30, durationMs: totalMs });
    const result = runJumpingJacksSession(frames);
    expect(result.completedReps.length).toBe(5);
  });
});
