import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildArmCirclesPose } from '../../harness/pose-stub';
import { runArmCirclesSession, countWarnings } from '../../harness/runner';
import type { ArmCirclesPoseIntent } from '../../harness/types';

const CAL_MS = 2200;

function makeFrames(repCycle: (tInRep: number) => Partial<ArmCirclesPoseIntent>, reps: number, repCycleMs: number) {
  return buildFrames(
    (tMs) => {
      if (tMs < CAL_MS) return { abductionDeg: 0 } as ArmCirclesPoseIntent;
      const tInRep = (tMs - CAL_MS) % repCycleMs;
      return { abductionDeg: 0, ...repCycle(tInRep) } as ArmCirclesPoseIntent;
    },
    buildArmCirclesPose,
    { fps: 30, durationMs: CAL_MS + reps * repCycleMs + 500 },
  );
}

describe('Arm Circles — rep validation gates', () => {
  // 2026-05-28 round 21: arms must reach overhead (≥140°) to count.
  it('rejects shallow reps (peak < MIN_REP_PEAK_DEG=140°)', () => {
    // Peak input 100° — at shoulder height, not overhead. Below 140° → too-shallow.
    const frames = makeFrames(
      (t) => {
        let abd: number;
        if (t < 800) abd = (t / 800) * 100;
        else if (t < 1300) abd = 100;
        else if (t < 2500) abd = 100 - ((t - 1300) / 1200) * 100;
        else abd = 0;
        return { abductionDeg: abd };
      },
      3,
      2800,
    );
    const result = runArmCirclesSession(frames);
    expect(result.completedReps.length).toBe(0);
    expect(countWarnings(result, 'incomplete-raise')).toBeGreaterThan(0);
  });

  it('rejects too-fast reps (full sweep in < MIN_REP_DURATION=1500ms)', () => {
    // Full sweep in 1000ms → too-fast.
    const frames = makeFrames(
      (t) => {
        let abd: number;
        if (t < 400) abd = (t / 400) * 160;
        else if (t < 600) abd = 160;
        else if (t < 1000) abd = 160 - ((t - 600) / 400) * 160;
        else abd = 0;
        return { abductionDeg: abd };
      },
      3,
      1400,
    );
    const result = runArmCirclesSession(frames);
    // Engine may reject as malformed-rep (too-fast) or ballistic depending on
    // velocity. Either way: no accepted reps.
    expect(result.completedReps.length).toBeLessThanOrEqual(1);
  });

  it('rejects asymmetric reps (one arm lagging > ARM_ASYMMETRY_DEG=30°)', () => {
    // Left intent 170° → measured ~176°; right intent 130° → measured ~136°.
    // Average smoothed peak ~156° (passes too-shallow=140); per-arm diff ~40° > 30°.
    const frames = makeFrames(
      (t) => {
        let leftAbd: number, rightAbd: number;
        if (t < 900) { leftAbd = (t / 900) * 170; rightAbd = (t / 900) * 130; }
        else if (t < 1500) { leftAbd = 170; rightAbd = 130; }
        else if (t < 2700) { leftAbd = 170 - ((t - 1500) / 1200) * 170; rightAbd = 130 - ((t - 1500) / 1200) * 130; }
        else { leftAbd = 0; rightAbd = 0; }
        return { abductionDeg: 0, leftAbductionDeg: leftAbd, rightAbductionDeg: rightAbd };
      },
      3,
      3000,
    );
    const result = runArmCirclesSession(frames);
    expect(result.completedReps.length).toBe(0);
    expect(countWarnings(result, 'arm-asymmetry')).toBeGreaterThan(0);
  });

  it('accepts valid overhead reps at the threshold (~150° peak, 2 s sweep)', () => {
    const frames = makeFrames(
      (t) => {
        let abd: number;
        if (t < 900) abd = (t / 900) * 150;
        else if (t < 1500) abd = 150;
        else if (t < 2700) abd = 150 - ((t - 1500) / 1200) * 150;
        else abd = 0;
        return { abductionDeg: abd };
      },
      4,
      3000,
    );
    const result = runArmCirclesSession(frames);
    expect(result.completedReps.length).toBeGreaterThanOrEqual(3);
  });
});
