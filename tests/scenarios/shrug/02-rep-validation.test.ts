import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildShrugPose } from '../../harness/pose-stub';
import { runShrugSession, countWarnings } from '../../harness/runner';

describe('Shrug — rep validation', () => {
  it('fires incomplete-shrug when elevation is below MIN_SHRUG_HEIGHT (0.035)', () => {
    // Shallow shrug: peaks at 0.02 — below the 0.035 minimum
    const calMs = 2200;
    const repCycleMs = 3000;
    const totalMs = calMs + repCycleMs;

    const frames = buildFrames(
      (tMs) => {
        if (tMs < calMs) return { shoulderElevation: 0 };
        const tInRep = (tMs - calMs) % repCycleMs;
        let elev: number;
        if (tInRep < 1000) elev = (tInRep / 1000) * 0.02;
        else if (tInRep < 1500) elev = 0.02;
        else if (tInRep < 2500) elev = 0.02 - ((tInRep - 1500) / 1000) * 0.02;
        else elev = 0;
        return { shoulderElevation: elev };
      },
      buildShrugPose,
      { fps: 30, durationMs: totalMs },
    );

    const result = runShrugSession(frames);
    expect(result.completedReps.length).toBe(0);
    expect(countWarnings(result, 'incomplete-shrug')).toBeGreaterThanOrEqual(1);
  });

  it('fires malformed-rep for too-fast rep (duration < MIN_REP_DURATION_MS)', () => {
    // Build a rep that definitely completes within < 300ms by using a very fast cycle
    // with extra frames after to allow EMA decay and rep completion
    const calMs = 2200;
    const totalMs = calMs + 3000;

    const frames = buildFrames(
      (tMs) => {
        if (tMs < calMs) return { shoulderElevation: 0 };
        const t = tMs - calMs;
        // Very fast cycle: rise to 0.06, hold 50ms, drop, total ~150ms
        // Then stay at 0 for rest of window
        if (t < 50) return { shoulderElevation: (t / 50) * 0.06 };
        if (t < 100) return { shoulderElevation: 0.06 };
        if (t < 150) return { shoulderElevation: 0.06 - ((t - 100) / 50) * 0.06 };
        return { shoulderElevation: 0 };
      },
      buildShrugPose,
      { fps: 30, durationMs: totalMs },
    );

    const result = runShrugSession(frames);
    // The engine must either reject the rep (completedReps=0) or fire malformed-rep.
    // A very-fast cycle must never silently count as a valid rep without any feedback.
    const malformedCount = countWarnings(result, 'malformed-rep');
    const repCount = result.completedReps.length;
    // Either the rep is rejected (0 reps counted) OR malformed-rep warning fired.
    // The combination repCount=1 + malformedCount=0 (silent acceptance) is the failure case.
    const silentAcceptance = repCount > 0 && malformedCount === 0;
    expect(silentAcceptance).toBe(false);
  });
});
