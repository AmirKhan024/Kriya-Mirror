import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildOTEPose } from '../../harness/pose-stub';
import { runOTESession, warningsOtherThan } from '../../harness/runner';

// Calibration: 2.2 s in EXTENDED position (extensionLevel=1.0, arms fully overhead).
// Each rep:
//   0–1000 ms : lower from ext=1.0 → ext=0.0 (extensionDeg 90° → 0°)
//   1000–1500 : hold at bottom (ext=0.0)
//   1500–2500 : press back up (ext=0.0 → 1.0)
//   2500–3000 : rest at top (ext=1.0)
function happyPathIntent(reps: number) {
  const calMs = 2200;
  const repCycleMs = 3000;
  const totalMs = calMs + reps * repCycleMs;
  return {
    totalMs,
    intentAt: (tMs: number) => {
      if (tMs < calMs) return { extensionLevel: 1.0 };
      const tInRep = (tMs - calMs) % repCycleMs;
      let ext: number;
      if (tInRep < 1000) ext = 1.0 - (tInRep / 1000);
      else if (tInRep < 1500) ext = 0.0;
      else if (tInRep < 2500) ext = (tInRep - 1500) / 1000;
      else ext = 1.0;
      return { extensionLevel: ext };
    },
  };
}

describe('Overhead Tricep Extension — happy path', () => {
  it('calibrates within 2.2s and counts 10 perfect reps', () => {
    const { totalMs, intentAt } = happyPathIntent(10);
    const frames = buildFrames(intentAt, buildOTEPose, { fps: 30, durationMs: totalMs });

    const result = runOTESession(frames);

    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThanOrEqual(2300);
    expect(result.completedReps.length).toBe(10);
    expect(warningsOtherThan(result, 'not-moving').length).toBe(0);
    const avgMqs = result.completedReps.reduce((s, r) => s + r.mqs, 0) / result.completedReps.length;
    expect(avgMqs).toBeGreaterThanOrEqual(55);
  });

  it('counts 5 reps when given a 5-rep stream', () => {
    const { totalMs, intentAt } = happyPathIntent(5);
    const frames = buildFrames(intentAt, buildOTEPose, { fps: 30, durationMs: totalMs });
    const result = runOTESession(frames);
    expect(result.completedReps.length).toBe(5);
  });

  it('depth score reflects range of motion', () => {
    const { totalMs, intentAt } = happyPathIntent(3);
    const frames = buildFrames(intentAt, buildOTEPose, { fps: 30, durationMs: totalMs });
    const result = runOTESession(frames);
    // Rep reaches extensionLevel=0 → depthDeg ≈ 90, completion should be high
    for (const rep of result.completedReps) {
      expect(rep.depthDeg).toBeGreaterThan(50);
    }
  });
});
