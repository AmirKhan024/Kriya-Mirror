import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildFrontRaisePose } from '../../harness/pose-stub';
import { runFrontRaiseSession, countWarnings } from '../../harness/runner';
import type { FrontRaisePoseIntent } from '../../harness/types';

const CAL_MS = 2200;

function makeFrames(repCycle: (tInRep: number) => Partial<FrontRaisePoseIntent>, reps = 3, repCycleMs = 2800) {
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

function repFlex(t: number, peak = 95): number {
  if (t < 800) return (t / 800) * peak;
  if (t < 1300) return peak;
  if (t < 2400) return peak - ((t - 1300) / 1100) * peak;
  return 0;
}

describe('Front Raise — posture warnings', () => {
  // 2026-05-28 round 21: torso-swing chip/speech emission DISABLED for
  // front-raise at engine level (mirror lateral-raise round 20). Natural
  // front-raise cadence shifts the shoulder mid X as the body counter-
  // balances arm motion. Form-score still tracks via repFormCounts.
  it('does NOT fire torso-swing chip even with sustained sway (round 21 disable)', () => {
    const frames = makeFrames((t) => {
      const flex = repFlex(t);
      const torsoSwayX = flex > 30 ? 0.06 : 0;
      return { shoulderFlexionDeg: flex, torsoSwayX };
    }, 3);
    const result = runFrontRaiseSession(frames);
    expect(countWarnings(result, 'torso-swing')).toBe(0);
  });

  it('does NOT fire any posture warnings on clean reps (sanity)', () => {
    const frames = makeFrames((t) => ({ shoulderFlexionDeg: repFlex(t) }), 3);
    const result = runFrontRaiseSession(frames);
    expect(countWarnings(result, 'torso-swing')).toBe(0);
    expect(countWarnings(result, 'incomplete-raise')).toBe(0);
    expect(countWarnings(result, 'arm-asymmetry')).toBe(0);
    expect(countWarnings(result, 'arms-too-high')).toBe(0);
    expect(countWarnings(result, 'arms-out-not-front')).toBe(0);
  });

  it('momentary torso sway does NOT fire any chip (verifies silence)', () => {
    const frames = makeFrames((t) => {
      const flex = repFlex(t);
      const torsoSwayX = t >= 900 && t <= 1020 ? 0.06 : 0;
      return { shoulderFlexionDeg: flex, torsoSwayX };
    }, 2);
    const result = runFrontRaiseSession(frames);
    expect(countWarnings(result, 'torso-swing')).toBe(0);
  });
});
