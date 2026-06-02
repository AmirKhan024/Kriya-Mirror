import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildShrugPose } from '../../harness/pose-stub';
import { runShrugSession, countWarnings } from '../../harness/runner';

describe('Shrug — not-moving after rep', () => {
  it('rep then 8s STANDING idle fires not-moving', () => {
    const calMs = 2200;
    const repCycleMs = 3000;
    const idleMs = 8000;
    const totalMs = calMs + repCycleMs + idleMs;

    const frames = buildFrames(
      (tMs) => {
        if (tMs < calMs) return { shoulderElevation: 0 };
        const afterCal = tMs - calMs;
        if (afterCal < repCycleMs) {
          // Perform a full rep
          const tInRep = afterCal % repCycleMs;
          let elev: number;
          if (tInRep < 1000) elev = (tInRep / 1000) * 0.05;
          else if (tInRep < 1500) elev = 0.05;
          else if (tInRep < 2500) elev = 0.05 - ((tInRep - 1500) / 1000) * 0.05;
          else elev = 0;
          return { shoulderElevation: elev };
        }
        // After rep: idle (no movement)
        return { shoulderElevation: 0 };
      },
      buildShrugPose,
      { fps: 30, durationMs: totalMs },
    );

    const result = runShrugSession(frames);
    expect(result.completedReps.length).toBe(1);
    expect(countWarnings(result, 'not-moving')).toBeGreaterThanOrEqual(1);
  });
});
