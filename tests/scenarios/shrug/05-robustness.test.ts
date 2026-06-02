import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildShrugPose } from '../../harness/pose-stub';
import { runShrugSession, warningsOtherThan } from '../../harness/runner';

describe('Shrug — robustness (5 sequential reps)', () => {
  it('counts 5 sequential reps with no state corruption', () => {
    const calMs = 2200;
    const repCycleMs = 3000;
    const totalMs = calMs + 5 * repCycleMs;

    const frames = buildFrames(
      (tMs) => {
        if (tMs < calMs) return { shoulderElevation: 0 };
        const tInRep = (tMs - calMs) % repCycleMs;
        let elev: number;
        if (tInRep < 1000) elev = (tInRep / 1000) * 0.05;
        else if (tInRep < 1500) elev = 0.05;
        else if (tInRep < 2500) elev = 0.05 - ((tInRep - 1500) / 1000) * 0.05;
        else elev = 0;
        return { shoulderElevation: elev };
      },
      buildShrugPose,
      { fps: 30, durationMs: totalMs },
    );

    const result = runShrugSession(frames);

    // All 5 reps should be counted
    expect(result.completedReps.length).toBe(5);
    // All reps should have reasonable MQS
    for (const rep of result.completedReps) {
      expect(rep.mqs).toBeGreaterThanOrEqual(40);
    }
    // No structural warnings
    expect(warningsOtherThan(result, 'not-moving').length).toBe(0);
  });
});
