import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildLateralRaisePose } from '../../harness/pose-stub';
import { runLateralRaiseSession, countWarnings } from '../../harness/runner';
import type { LateralRaisePoseIntent } from '../../harness/types';

const CAL_MS = 2200;

function makeFrames(repCycle: (tInRep: number) => Partial<LateralRaisePoseIntent>, reps: number, repCycleMs: number) {
  return buildFrames(
    (tMs) => {
      if (tMs < CAL_MS) return { abductionDeg: 0 } as LateralRaisePoseIntent;
      const tInRep = (tMs - CAL_MS) % repCycleMs;
      return { abductionDeg: 0, ...repCycle(tInRep) } as LateralRaisePoseIntent;
    },
    buildLateralRaisePose,
    { fps: 30, durationMs: CAL_MS + reps * repCycleMs + 500 },
  );
}

describe('Lateral Raise — rep validation gates', () => {
  it('rejects shallow reps (peak < MIN_REP_PEAK_DEG=75°)', () => {
    // Peak input abduction 55° → smoothed peak stays well below 75°.
    const frames = makeFrames(
      (t) => {
        let abd: number;
        if (t < 1000) abd = (t / 1000) * 55;
        else if (t < 1500) abd = 55;
        else if (t < 2500) abd = 55 - ((t - 1500) / 1000) * 55;
        else abd = 0;
        return { abductionDeg: abd };
      },
      5,
      3000,
    );
    const result = runLateralRaiseSession(frames);
    expect(result.completedReps.length).toBe(0);
    expect(countWarnings(result, 'incomplete-raise')).toBeGreaterThan(0);
  });

  it('rejects asymmetric reps (only right arm raises)', () => {
    // Round 20: validateRepShape reorder put too-shallow BEFORE asymmetric,
    // so the "one-arm" rep now reports too-shallow (avg peak ~44°). Asymmetric
    // is now reserved for reps that DO reach valid depth but with a clearly
    // uneven peak (see test below at "rejects asymmetric reps with valid depth").
    const frames = makeFrames(
      (t) => {
        let abd: number;
        if (t < 1000) abd = (t / 1000) * 90;
        else if (t < 1500) abd = 90;
        else if (t < 2500) abd = 90 - ((t - 1500) / 1000) * 90;
        else abd = 0;
        return { abductionDeg: 0, leftAbductionDeg: 0, rightAbductionDeg: abd };
      },
      3,
      3000,
    );
    const result = runLateralRaiseSession(frames);
    expect(result.completedReps.length).toBe(0);
    // Round 20: now reports incomplete-raise (too-shallow), not arm-asymmetry,
    // because avg peak is below MIN_REP_PEAK_DEG=75°.
    expect(countWarnings(result, 'incomplete-raise')).toBeGreaterThan(0);
  });

  // 2026-05-28 round 20 — asymmetric with VALID depth (avg peak ≥ 75°). Tests
  // that ARM_ASYMMETRY_DEG=25° threshold catches genuine one-arm-lagging reps.
  it('rejects asymmetric reps when both arms reach valid depth but differ ≥ 25°', () => {
    const frames = makeFrames(
      (t) => {
        const cycle = (peak: number) => {
          if (t < 1000) return (t / 1000) * peak;
          if (t < 1500) return peak;
          if (t < 2500) return peak - ((t - 1500) / 1000) * peak;
          return 0;
        };
        // L=70° peak, R=110° peak → diff 40° (above new 25° threshold).
        // Avg=90° (passes too-shallow + arms-too-high range).
        return { abductionDeg: 0, leftAbductionDeg: cycle(70), rightAbductionDeg: cycle(110) };
      },
      3,
      3000,
    );
    const result = runLateralRaiseSession(frames);
    expect(result.completedReps.length).toBe(0);
    expect(countWarnings(result, 'arm-asymmetry')).toBeGreaterThan(0);
  });

  // 2026-05-28 round 20 — round-20 ARM_ASYMMETRY_DEG=25° absorbs MediaPipe
  // wrist-landmark noise on real bilateral reps. ~20° L/R diff is now ACCEPTED
  // (was rejected at the 15° threshold pre-round-20).
  it('accepts a rep with ~20° L/R asymmetry (within new tolerance)', () => {
    const frames = makeFrames(
      (t) => {
        const cycle = (peak: number) => {
          if (t < 1000) return (t / 1000) * peak;
          if (t < 1500) return peak;
          if (t < 2500) return peak - ((t - 1500) / 1000) * peak;
          return 0;
        };
        // L=80° peak, R=100° peak → diff 20° (below new 25° threshold).
        // Avg=90° (clean rep otherwise).
        return { abductionDeg: 0, leftAbductionDeg: cycle(80), rightAbductionDeg: cycle(100) };
      },
      3,
      3000,
    );
    const result = runLateralRaiseSession(frames);
    expect(result.completedReps.length).toBe(3);
    expect(countWarnings(result, 'arm-asymmetry')).toBe(0);
  });

  // 2026-05-28 round 20 — regression for the reorder. MediaPipe sometimes
  // mislocalizes ONE wrist to an overhead position on an otherwise valid
  // lateral raise. Pre-round-20 the asymmetric check (~50° L/R diff) fired
  // FIRST. Post-round-20 reorder, arms-too-high fires first — a more accurate
  // verdict on what the user actually did (or the model thinks they did).
  it('reports arms-too-high (not asymmetric) when one wrist lands overhead', () => {
    const frames = makeFrames(
      (t) => {
        const cycle = (peak: number) => {
          if (t < 1000) return (t / 1000) * peak;
          if (t < 1500) return peak;
          if (t < 2500) return peak - ((t - 1500) / 1000) * peak;
          return 0;
        };
        // L=88° (clean), R=165° (mislocalized overhead). Avg peak = 126.5°,
        // which is below MAX_REP_PEAK_DEG=130 — BUT the per-frame max(left,right)
        // for the SMOOTHED avg-abduction state machine peaks above 130° once
        // EMA settles. Tune: push R to 175° so EMA-smoothed avg clearly exceeds 130°.
        return { abductionDeg: 0, leftAbductionDeg: cycle(88), rightAbductionDeg: cycle(175) };
      },
      3,
      3000,
    );
    const result = runLateralRaiseSession(frames);
    expect(result.completedReps.length).toBe(0);
    expect(countWarnings(result, 'arms-too-high')).toBeGreaterThan(0);
    expect(countWarnings(result, 'arm-asymmetry')).toBe(0);
  });

  it('accepts a fast-but-clean rep (~1.4s total movement) without ballistic rejection', () => {
    // 700ms up + 700ms down — faster than the happy-path's 2s movement.
    // Verifies MAX_WRIST_VELOCITY=5.0 leaves headroom for real fast reps
    // (lateral-raise wrist arc is 1.7× bicep-curl's, so bicep's 4.0 is too tight).
    const frames = makeFrames(
      (t) => {
        let abd: number;
        if (t < 700) abd = (t / 700) * 88;
        else if (t < 900) abd = 88;
        else if (t < 1600) abd = 88 - ((t - 900) / 700) * 88;
        else abd = 0;
        return { abductionDeg: abd };
      },
      3,
      2000,
    );
    const result = runLateralRaiseSession(frames);
    expect(result.completedReps.length).toBe(3);
  });

  it('accepts a valid rep at the minimum-depth boundary (78° peak)', () => {
    const frames = makeFrames(
      (t) => {
        let abd: number;
        if (t < 800) abd = (t / 800) * 88;     // slightly over 75° smoothed
        else if (t < 1200) abd = 88;
        else if (t < 2000) abd = 88 - ((t - 1200) / 800) * 88;
        else abd = 0;
        return { abductionDeg: abd };
      },
      3,
      2500,
    );
    const result = runLateralRaiseSession(frames);
    expect(result.completedReps.length).toBe(3);
  });

  // 2026-05-28 round 19 regression — mirrors physical-test cheats from logs
  // where reps peaked at 174° / 178° (arms straight overhead) and incorrectly
  // counted. Engine must now reject these as arms-too-high.
  it('rejects "arms overhead" reps (peak abduction ≈ 175°)', () => {
    const frames = makeFrames(
      (t) => {
        // Same shape as the happy-path rep, but PEAK is at 175° instead of 88°.
        let abd: number;
        if (t < 1000) abd = (t / 1000) * 175;
        else if (t < 1500) abd = 175;
        else if (t < 2500) abd = 175 - ((t - 1500) / 1000) * 175;
        else abd = 0;
        return { abductionDeg: abd };
      },
      3,
      3000,
    );
    const result = runLateralRaiseSession(frames);
    expect(result.completedReps.length).toBe(0);
    expect(countWarnings(result, 'arms-too-high')).toBeGreaterThan(0);
  });

  // 2026-05-28 round 19 regression — front raise instead of lateral. Wrist
  // stays near the shoulder X (2D projection of "arm pointing forward"),
  // abduction angle still hits 90° but the engine rejects because the wrist
  // didn't go OUTWARD past MIN_WRIST_OUTWARD_RATIO=0.8.
  it('rejects "arms forward" reps (front raise instead of lateral)', () => {
    const frames = makeFrames(
      (t) => {
        let abd: number;
        if (t < 1000) abd = (t / 1000) * 90;
        else if (t < 1500) abd = 90;
        else if (t < 2500) abd = 90 - ((t - 1500) / 1000) * 90;
        else abd = 0;
        return { abductionDeg: abd, wristForwardOverride: true };
      },
      3,
      3000,
    );
    const result = runLateralRaiseSession(frames);
    expect(result.completedReps.length).toBe(0);
    expect(countWarnings(result, 'arms-forward-not-side')).toBeGreaterThan(0);
  });
});
