import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildChairDipPose } from '../../harness/pose-stub';
import { runChairDipSession, countWarnings } from '../../harness/runner';
import type { ChairDipPoseIntent } from '../../harness/types';

/** Linearly ramps shoulderDescentY from 0 at flex≤5° to 0.04 at flex≥90°. */
function dipShoulderDescent(flex: number): number {
  return Math.max(0, Math.min(0.04, (flex - 5) / 85 * 0.04));
}

// Calibration window: 500ms with arms extended at sides (flex=5).
const CAL_MS = 500;

function makeFrames(
  repCycle: (tInRep: number) => Partial<ChairDipPoseIntent>,
  reps: number,
  repCycleMs: number,
) {
  return buildFrames(
    (tMs) => {
      if (tMs < CAL_MS) {
        return { elbowFlexionDeg: 5, feetWidthRatio: 1.0, bodyHeight: 0.70 } as ChairDipPoseIntent;
      }
      const tInRep = (tMs - CAL_MS) % repCycleMs;
      return { elbowFlexionDeg: 5, feetWidthRatio: 1.0, bodyHeight: 0.70, ...repCycle(tInRep) } as ChairDipPoseIntent;
    },
    buildChairDipPose,
    { fps: 30, durationMs: CAL_MS + reps * repCycleMs + 500 },
  );
}

describe('Chair Dip — rep validation gates', () => {
  it('Test A: rejects shallow dip (peak < MIN_REP_DEPTH=60°) and fires incomplete-dip warning', () => {
    // Rep only reaches 40° — below the 60° minimum depth threshold.
    // shoulderDescentY=0.04 (fixed) ensures the descent gate passes so the rep
    // reaches the depth check and fires incomplete-dip (not no-body-movement).
    const repCycleMs = 2500;
    const frames = makeFrames(
      (t) => {
        let flex: number;
        if (t < 300) flex = 5;
        else if (t < 800) flex = 5 + ((t - 300) / 500) * 35; // 5 → 40
        else if (t < 1000) flex = 40;
        else if (t < 1500) flex = 40 - ((t - 1000) / 500) * 35; // 40 → 5
        else flex = 5;
        return { elbowFlexionDeg: flex, shoulderDescentY: 0.04 };
      },
      5,
      repCycleMs,
    );
    const result = runChairDipSession(frames);
    expect(result.completedReps.length).toBe(0);
    expect(countWarnings(result, 'incomplete-dip')).toBeGreaterThan(0);
  });

  it('Test B: ultra-fast reps (160ms active phase) are not counted — EMA smoothing prevents state machine completion', () => {
    // The rep rises from 5→90→5 in 160ms. With EMA alpha=0.15 at 30fps, the
    // smoothed flex only reaches ~35° before the raw falls back, never reaching
    // the AT_BOTTOM stable state. The state machine stays in DIPPING and no
    // completeRep() fires. MIN_REP_DURATION_MS and malformed-rep are not
    // reachable via this path — ballistic protection is provided by the
    // EMA filter preventing completion rather than post-completion validation.
    const repCycleMs = 400;
    const frames = makeFrames(
      (t) => {
        let flex: number;
        if (t < 60) flex = 5 + (t / 60) * 85;     // 5 → 90 in 60ms
        else if (t < 100) flex = 90;
        else if (t < 160) flex = 90 - ((t - 100) / 60) * 85; // 90 → 5 in 60ms
        else flex = 5;
        return { elbowFlexionDeg: flex };
      },
      5,
      repCycleMs,
    );
    const result = runChairDipSession(frames);
    expect(result.completedReps.length).toBe(0);
  });

  it('Test C: rejects unilateral rep (left arm dips to 90°, right only reaches 20°) and fires malformed-rep warning', () => {
    // Unilateral symmetry gate: ratio of weak-arm peak / strong-arm peak < 0.70.
    // 20 / 90 ≈ 0.22 — clearly fails the bilateral symmetry check.
    const repCycleMs = 2500;
    const frames = makeFrames(
      (t) => {
        let leftFlex: number;
        let rightFlex: number;
        if (t < 300) {
          leftFlex = 5;
          rightFlex = 5;
        } else if (t < 800) {
          leftFlex = 5 + ((t - 300) / 500) * 85;   // left: 5 → 90
          rightFlex = 5 + ((t - 300) / 500) * 15;   // right: 5 → 20
        } else if (t < 1000) {
          leftFlex = 90;
          rightFlex = 20;
        } else if (t < 1500) {
          leftFlex = 90 - ((t - 1000) / 500) * 85;  // left: 90 → 5
          rightFlex = 20 - ((t - 1000) / 500) * 15; // right: 20 → 5
        } else {
          leftFlex = 5;
          rightFlex = 5;
        }
        return {
          elbowFlexionDeg: 5,
          leftElbowFlexionDeg: leftFlex,
          rightElbowFlexionDeg: rightFlex,
          shoulderDescentY: 0.04,
        };
      },
      3,
      repCycleMs,
    );
    const result = runChairDipSession(frames);
    expect(result.completedReps.length).toBe(0);
    expect(countWarnings(result, 'malformed-rep')).toBeGreaterThan(0);
  });
});
