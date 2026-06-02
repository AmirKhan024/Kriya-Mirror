/**
 * Reverse Fly — warning gating (Fix A).
 * No per-frame form warnings should fire while in DOWN state (arms at rest).
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildReverseFlyPose } from '../../harness/pose-stub';
import { runReverseFlySession } from '../../harness/runner';

const CAL_MS = 300;

describe('Reverse Fly — warning gating (Fix A)', () => {
  it('no form warnings fire while in DOWN state (only not-moving after timeout)', () => {
    // After calibration, user stays at rest (DOWN) for 4s — no form warnings should fire
    // (not-moving fires only after 5s, so 4s idle produces nothing)
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) return { armLiftDeg: 0, bentOver: true };
        return { armLiftDeg: 0, bentOver: true };  // Stay at rest
      },
      buildReverseFlyPose,
      { fps: 30, durationMs: CAL_MS + 4000 },
    );

    const result = runReverseFlySession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    // No warnings at all in 4s (not-moving fires at 5s)
    expect(result.warnings.length).toBe(0);
  });

  it('not-moving fires after 5s idle in DOWN state (the only expected warning)', () => {
    // 5.5s idle after calibration → only not-moving fires, no form warnings
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) return { armLiftDeg: 0, bentOver: true };
        return { armLiftDeg: 0, bentOver: true };
      },
      buildReverseFlyPose,
      { fps: 30, durationMs: CAL_MS + 5500 },
    );

    const result = runReverseFlySession(frames);
    // Only not-moving should fire, no other form warnings
    const unexpectedWarnings = result.warnings.filter(
      (w) => w.type !== 'not-moving',
    );
    expect(unexpectedWarnings.length).toBe(0);
  });

  it('no warnings fire during active rep (DOWN→RAISING→AT_TOP→LOWERING) for clean rep', () => {
    // Clean rep, no asymmetry, good depth — zero warnings during the rep itself
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) return { armLiftDeg: 0, bentOver: true };
        const tRep = tMs - CAL_MS;
        let liftDeg: number;
        if (tRep < 1000)      liftDeg = (tRep / 1000) * 70;
        else if (tRep < 1500) liftDeg = 70;
        else if (tRep < 2500) liftDeg = 70 - ((tRep - 1500) / 1000) * 70;
        else                  liftDeg = 0;
        return { armLiftDeg: liftDeg, bentOver: true };
      },
      buildReverseFlyPose,
      { fps: 30, durationMs: CAL_MS + 3000 },
    );

    const result = runReverseFlySession(frames);
    expect(result.completedReps.length).toBe(1);
    expect(result.warnings.length).toBe(0);
  });
});
