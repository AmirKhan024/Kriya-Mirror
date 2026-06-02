import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildHammerCurlPose } from '../../harness/pose-stub';
import { runHammerCurlSession, countWarnings } from '../../harness/runner';
import type { HammerCurlPoseIntent } from '../../harness/types';

const CAL_MS = 2200;

function makeFrames(repCycle: (tInRep: number) => Partial<HammerCurlPoseIntent>, reps = 3, repCycleMs = 3000) {
  return buildFrames(
    (tMs) => {
      if (tMs < CAL_MS) return { elbowFlexionDeg: 0 } as HammerCurlPoseIntent;
      const tInRep = (tMs - CAL_MS) % repCycleMs;
      return { elbowFlexionDeg: 0, ...repCycle(tInRep) } as HammerCurlPoseIntent;
    },
    buildHammerCurlPose,
    { fps: 30, durationMs: CAL_MS + reps * repCycleMs + 500 },
  );
}

function repFlex(t: number, peak = 130): number {
  if (t < 1000) return (t / 1000) * peak;
  if (t < 1500) return peak;
  if (t < 2500) return peak - ((t - 1500) / 1000) * peak;
  return 0;
}

describe('Hammer Curl — posture warnings', () => {
  it('fires torso-swing warning when shoulder mid x oscillates past threshold', () => {
    const frames = makeFrames((t) => {
      const flex = repFlex(t);
      const torsoSwayX = flex > 30 ? 0.06 : 0;
      return { elbowFlexionDeg: flex, torsoSwayX };
    }, 3);
    const result = runHammerCurlSession(frames);
    expect(countWarnings(result, 'torso-swing')).toBeGreaterThan(0);
  });

  it('fires elbow-drift warning when elbows move outward past threshold', () => {
    const frames = makeFrames((t) => {
      const flex = repFlex(t);
      const elbowDriftX = flex > 30 ? 0.08 : 0;
      return { elbowFlexionDeg: flex, elbowDriftX };
    }, 3);
    const result = runHammerCurlSession(frames);
    expect(countWarnings(result, 'elbow-drift')).toBeGreaterThan(0);
  });

  it('does NOT fire any posture warnings on clean reps (sanity)', () => {
    const frames = makeFrames((t) => ({ elbowFlexionDeg: repFlex(t) }), 3);
    const result = runHammerCurlSession(frames);
    expect(countWarnings(result, 'torso-swing')).toBe(0);
    expect(countWarnings(result, 'elbow-drift')).toBe(0);
    expect(countWarnings(result, 'incomplete-curl')).toBe(0);
  });

  it('momentary torso sway (4 frames) does NOT trigger a warning', () => {
    const frames = makeFrames((t) => {
      const flex = repFlex(t);
      const torsoSwayX = t >= 1200 && t <= 1320 ? 0.06 : 0;
      return { elbowFlexionDeg: flex, torsoSwayX };
    }, 2);
    const result = runHammerCurlSession(frames);
    expect(countWarnings(result, 'torso-swing')).toBe(0);
  });
});
