import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildFrontRaisePose } from '../../harness/pose-stub';
import { runFrontRaiseSession, countWarnings } from '../../harness/runner';
import type { FrontRaisePoseIntent } from '../../harness/types';

const CAL_MS = 2200;

function makeFrames(repCycle: (tInRep: number) => Partial<FrontRaisePoseIntent>, reps: number, repCycleMs: number) {
  return buildFrames(
    (tMs) => {
      if (tMs < CAL_MS) return { shoulderFlexionDeg: 0 } as FrontRaisePoseIntent;
      const tInRep = (tMs - CAL_MS) % repCycleMs;
      return { shoulderFlexionDeg: 0, ...repCycle(tInRep) } as FrontRaisePoseIntent;
    },
    buildFrontRaisePose,
    { fps: 30, durationMs: CAL_MS + reps * repCycleMs + 500 },
  );
}

describe('Front Raise — rep validation gates', () => {
  it('rejects shallow reps (peak < MIN_REP_DEPTH_DEG=75°)', () => {
    // Peak input flex 60° → smoothed peak stays well below 75°.
    const frames = makeFrames(
      (t) => {
        let flex: number;
        if (t < 800) flex = (t / 800) * 60;
        else if (t < 1300) flex = 60;
        else if (t < 2400) flex = 60 - ((t - 1300) / 1100) * 60;
        else flex = 0;
        return { shoulderFlexionDeg: flex };
      },
      5,
      2800,
    );
    const result = runFrontRaiseSession(frames);
    expect(result.completedReps.length).toBe(0);
    expect(countWarnings(result, 'incomplete-raise')).toBeGreaterThan(0);
  });

  it('rejects asymmetric reps (one arm well below the other)', () => {
    // Left intent 95° → measured ~115°; right intent 80° → measured ~61°.
    // Avg smoothed peak ~88° (passes too-shallow=75).
    // Per-arm peak diff ~54° > ARM_ASYMMETRY_DEG=25 → fails as asymmetric.
    const frames = makeFrames(
      (t) => {
        let leftFlex: number, rightFlex: number;
        if (t < 800) { leftFlex = (t / 800) * 95; rightFlex = (t / 800) * 80; }
        else if (t < 1300) { leftFlex = 95; rightFlex = 80; }
        else if (t < 2400) { leftFlex = 95 - ((t - 1300) / 1100) * 95; rightFlex = 80 - ((t - 1300) / 1100) * 80; }
        else { leftFlex = 0; rightFlex = 0; }
        return { shoulderFlexionDeg: 0, leftShoulderFlexionDeg: leftFlex, rightShoulderFlexionDeg: rightFlex };
      },
      3,
      2800,
    );
    const result = runFrontRaiseSession(frames);
    expect(result.completedReps.length).toBe(0);
    expect(countWarnings(result, 'arm-asymmetry')).toBeGreaterThan(0);
  });

  it('accepts valid reps at the minimum-depth boundary (~95° + 2 s)', () => {
    const frames = makeFrames(
      (t) => {
        let flex: number;
        if (t < 700) flex = (t / 700) * 95;
        else if (t < 1200) flex = 95;
        else if (t < 2100) flex = 95 - ((t - 1200) / 900) * 95;
        else flex = 0;
        return { shoulderFlexionDeg: flex };
      },
      3,
      2500,
    );
    const result = runFrontRaiseSession(frames);
    expect(result.completedReps.length).toBe(3);
  });

  // 2026-05-28 round 23 — LENIENT rollback. The round-21/22 plane discriminators
  // (arms-too-high overhead-press gate, arms-out-not-front lateral-raise gate)
  // were removed at user request. Reps now count regardless of arm direction
  // — forward, lateral, AND overhead arm raises all accept. These three test
  // cases validate the lenient behavior.

  it('accepts overhead presses (round 23 lenient)', () => {
    // Pre-round-23: rejected as arms-too-high. Now accepted.
    const frames = makeFrames(
      (t) => {
        let flex: number;
        if (t < 800) flex = (t / 800) * 165;
        else if (t < 1300) flex = 165;
        else if (t < 2400) flex = 165 - ((t - 1300) / 1100) * 165;
        else flex = 0;
        return { shoulderFlexionDeg: flex };
      },
      3,
      2800,
    );
    const result = runFrontRaiseSession(frames);
    expect(result.completedReps.length).toBeGreaterThanOrEqual(2);
    expect(countWarnings(result, 'arms-too-high')).toBe(0);
  });

  it('accepts lateral raises (round 23 lenient)', () => {
    // Pre-round-23: rejected as arms-out-not-front. Now accepted.
    const frames = makeFrames(
      (t) => {
        let flex: number;
        if (t < 800) flex = (t / 800) * 95;
        else if (t < 1300) flex = 95;
        else if (t < 2400) flex = 95 - ((t - 1300) / 1100) * 95;
        else flex = 0;
        return { shoulderFlexionDeg: flex, armOutwardFactor: 0.9 };
      },
      3,
      2800,
    );
    const result = runFrontRaiseSession(frames);
    expect(result.completedReps.length).toBeGreaterThanOrEqual(2);
    expect(countWarnings(result, 'arms-out-not-front')).toBe(0);
  });

  it('accepts forward raises with natural elbow flare — happy mid-range case', () => {
    // Validates the lenient behavior on the user's reported "real" front raise.
    const frames = makeFrames(
      (t) => {
        let flex: number;
        if (t < 800) flex = (t / 800) * 90;
        else if (t < 1300) flex = 90;
        else if (t < 2400) flex = 90 - ((t - 1300) / 1100) * 90;
        else flex = 0;
        return { shoulderFlexionDeg: flex, armOutwardFactor: 0.40 };
      },
      3,
      2800,
    );
    const result = runFrontRaiseSession(frames);
    expect(result.completedReps.length).toBeGreaterThanOrEqual(2);
    expect(countWarnings(result, 'arms-out-not-front')).toBe(0);
    expect(countWarnings(result, 'arms-too-high')).toBe(0);
  });
});
