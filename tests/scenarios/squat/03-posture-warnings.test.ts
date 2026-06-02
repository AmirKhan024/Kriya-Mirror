import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildSquatPose } from '../../harness/pose-stub';
import { runSquatSession, countWarnings } from '../../harness/runner';
import type { SquatPoseIntent } from '../../harness/types';

const CAL_MS = 2200;

function makeFrames(repCycle: (tInRep: number) => Partial<SquatPoseIntent>, reps = 3, repCycleMs = 3000) {
  return buildFrames(
    (tMs) => {
      if (tMs < CAL_MS) {
        return { kneeFlexionDeg: 0, feetWidthRatio: 1.25, armsOverhead: true } as SquatPoseIntent;
      }
      const tInRep = (tMs - CAL_MS) % repCycleMs;
      return { feetWidthRatio: 1.25, armsOverhead: false, ...repCycle(tInRep) } as SquatPoseIntent;
    },
    buildSquatPose,
    { fps: 30, durationMs: CAL_MS + reps * repCycleMs + 500 },
  );
}

function repTrajectoryFlex(t: number, peak = 100): number {
  if (t < 1000) return (t / 1000) * peak;
  if (t < 1500) return peak;
  if (t < 2500) return peak - ((t - 1500) / 1000) * peak;
  return 0;
}

describe('Squat — posture warnings', () => {
  it('fires heel-lift warning when ankle Y rises during a rep', () => {
    const frames = makeFrames((t) => {
      const flex = repTrajectoryFlex(t);
      // Lift heels by 0.04 (well past HEEL_LIFT_THRESHOLD=0.032) at the bottom of the rep
      const heelLift = flex > 60 ? 0.045 : 0;
      return { kneeFlexionDeg: flex, heelLift };
    }, 2);
    const result = runSquatSession(frames);
    expect(countWarnings(result, 'heel-lift')).toBeGreaterThan(0);
  });

  it('fires valgus warning when knees collapse inward at peak', () => {
    // 2026-05-25: un-skipped after pose-stub valgusRatio was rewritten to
    // interpolate knee X toward the midline. valgusRatio=0.7 reliably puts
    // current kneeWidth below 85% of baseline (engine threshold).
    // Note: this test uses brief valgus (only at deep flex) so the rep STILL
    // counts but emits the warning. For full-rep valgus → rep rejection, see
    // 12-collapsed-knees-regression.test.ts.
    const frames = makeFrames((t) => {
      const flex = repTrajectoryFlex(t);
      const valgusRatio = flex > 80 ? 0.7 : 0;
      return { kneeFlexionDeg: flex, valgusRatio };
    }, 2);
    const result = runSquatSession(frames);
    expect(countWarnings(result, 'valgus')).toBeGreaterThan(0);
  });

  it('fires trunk-forward warning when trunk leans past 55°', () => {
    const frames = makeFrames((t) => {
      const flex = repTrajectoryFlex(t);
      const trunkLeanDeg = flex > 60 ? 65 : 0;
      return { kneeFlexionDeg: flex, trunkLeanDeg };
    }, 2);
    const result = runSquatSession(frames);
    expect(countWarnings(result, 'trunk-forward')).toBeGreaterThan(0);
  });

  it('does NOT fire heel-lift on a clean rep (sanity)', () => {
    const frames = makeFrames((t) => ({ kneeFlexionDeg: repTrajectoryFlex(t) }), 3);
    const result = runSquatSession(frames);
    expect(countWarnings(result, 'heel-lift')).toBe(0);
    expect(countWarnings(result, 'valgus')).toBe(0);
    expect(countWarnings(result, 'trunk-forward')).toBe(0);
  });
});

describe('Squat — warning debounce', () => {
  it('momentary heel lift (6 frames) does NOT trigger a warning', () => {
    // Lift heel for only 6 frames (~200ms at 30fps), below HEEL_LIFT_DEBOUNCE_FRAMES=12
    const frames = makeFrames((t) => {
      const flex = repTrajectoryFlex(t);
      const heelLift = t >= 1200 && t <= 1400 ? 0.045 : 0; // ~6 frames
      return { kneeFlexionDeg: flex, heelLift };
    }, 2);
    const result = runSquatSession(frames);
    expect(countWarnings(result, 'heel-lift')).toBe(0);
  });

  it('sustained heel lift (>12 frames) triggers a warning', () => {
    const frames = makeFrames((t) => {
      const flex = repTrajectoryFlex(t);
      const heelLift = t >= 1200 && t <= 2000 ? 0.045 : 0; // ~24 frames
      return { kneeFlexionDeg: flex, heelLift };
    }, 2);
    const result = runSquatSession(frames);
    expect(countWarnings(result, 'heel-lift')).toBeGreaterThan(0);
  });
});
