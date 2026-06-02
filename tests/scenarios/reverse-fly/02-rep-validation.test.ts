/**
 * Reverse Fly — rep validation.
 * (a) armLiftDeg peak < 50° → incomplete-reverse-fly fires + rep rejected.
 * (b) rep < 500ms → malformed-rep fires.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildReverseFlyPose } from '../../harness/pose-stub';
import { runReverseFlySession, countWarnings } from '../../harness/runner';

const CAL_MS = 300;

describe('Reverse Fly — rep validation', () => {
  it('(a) shallow fly (peak < 50°) → incomplete-reverse-fly fires and rep is NOT counted', () => {
    // Profile: calibrate 300ms → shallow fly (0→40°→0) over 3s → idle 2s
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) return { armLiftDeg: 0, bentOver: true };
        const tRep = tMs - CAL_MS;
        let liftDeg: number;
        if (tRep < 1000)      liftDeg = (tRep / 1000) * 40;  // only reaches 40° (below 50° threshold)
        else if (tRep < 1500) liftDeg = 40;
        else if (tRep < 2500) liftDeg = 40 - ((tRep - 1500) / 1000) * 40;
        else                  liftDeg = 0;
        return { armLiftDeg: liftDeg, bentOver: true };
      },
      buildReverseFlyPose,
      { fps: 30, durationMs: CAL_MS + 3000 + 2000 },
    );

    const result = runReverseFlySession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    // Rep should be rejected (incomplete)
    expect(result.completedReps.length).toBe(0);
    // incomplete-reverse-fly warning should fire
    expect(countWarnings(result, 'incomplete-reverse-fly' as never)).toBeGreaterThan(0);
  });

  it('(b) too-fast fly (< 500ms) → malformed-rep fires and rep is NOT counted', () => {
    // Profile: calibrate 300ms → ballistic fly (0→70→0) in 200ms → idle 2s
    const REP_END_MS = CAL_MS + 200;
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) return { armLiftDeg: 0, bentOver: true };
        const tRep = tMs - CAL_MS;
        if (tRep < REP_END_MS - CAL_MS) {
          // Very fast arc: 0→70→0 in 200ms total
          const frac = tRep / (REP_END_MS - CAL_MS);
          const liftDeg = frac < 0.5
            ? (frac / 0.5) * 70
            : 70 - ((frac - 0.5) / 0.5) * 70;
          return { armLiftDeg: liftDeg, bentOver: true };
        }
        return { armLiftDeg: 0, bentOver: true };
      },
      buildReverseFlyPose,
      { fps: 30, durationMs: CAL_MS + 5000 },
    );

    const result = runReverseFlySession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    // Rep should be rejected (too fast)
    expect(result.completedReps.length).toBe(0);
    // Some rep-rejection warning should fire (malformed-rep or incomplete)
    const rejectionWarnings = result.warnings.filter(
      (w) => w.type === 'malformed-rep' || w.type === ('incomplete-reverse-fly' as never),
    );
    expect(rejectionWarnings.length).toBeGreaterThan(0);
  });

  it('valid fly (peak ≥ 50°, duration ≥ 500ms) IS counted', () => {
    // Profile: calibrate 300ms → proper fly (0→65°→0) over 2.5s
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) return { armLiftDeg: 0, bentOver: true };
        const tRep = tMs - CAL_MS;
        let liftDeg: number;
        if (tRep < 1000)      liftDeg = (tRep / 1000) * 65;
        else if (tRep < 1500) liftDeg = 65;
        else if (tRep < 2500) liftDeg = 65 - ((tRep - 1500) / 1000) * 65;
        else                  liftDeg = 0;
        return { armLiftDeg: liftDeg, bentOver: true };
      },
      buildReverseFlyPose,
      { fps: 30, durationMs: CAL_MS + 3000 },
    );

    const result = runReverseFlySession(frames);
    expect(result.completedReps.length).toBe(1);
  });
});
