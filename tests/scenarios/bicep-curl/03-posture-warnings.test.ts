import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildBicepCurlPose } from '../../harness/pose-stub';
import { runBicepCurlSession, countWarnings } from '../../harness/runner';
import type { BicepCurlPoseIntent } from '../../harness/types';

const CAL_MS = 2200;

function makeFrames(repCycle: (tInRep: number) => Partial<BicepCurlPoseIntent>, reps = 3, repCycleMs = 3000) {
  return buildFrames(
    (tMs) => {
      if (tMs < CAL_MS) return { elbowFlexionDeg: 0 } as BicepCurlPoseIntent;
      const tInRep = (tMs - CAL_MS) % repCycleMs;
      return { elbowFlexionDeg: 0, ...repCycle(tInRep) } as BicepCurlPoseIntent;
    },
    buildBicepCurlPose,
    { fps: 30, durationMs: CAL_MS + reps * repCycleMs + 500 },
  );
}

function repFlex(t: number, peak = 130): number {
  if (t < 1000) return (t / 1000) * peak;
  if (t < 1500) return peak;
  if (t < 2500) return peak - ((t - 1500) / 1000) * peak;
  return 0;
}

describe('Bicep Curl — posture warnings', () => {
  it('fires torso-swing warning when shoulder mid x oscillates past threshold', () => {
    const frames = makeFrames((t) => {
      const flex = repFlex(t);
      // Sustained sway of 0.06 (past 0.04 threshold) during active phases
      const torsoSwayX = flex > 30 ? 0.06 : 0;
      return { elbowFlexionDeg: flex, torsoSwayX };
    }, 3);
    const result = runBicepCurlSession(frames);
    expect(countWarnings(result, 'torso-swing')).toBeGreaterThan(0);
  });

  it('fires elbow-drift warning when elbows move outward past threshold', () => {
    const frames = makeFrames((t) => {
      const flex = repFlex(t);
      // Elbows drifting outward by 0.08 (past 0.06 threshold)
      const elbowDriftX = flex > 30 ? 0.08 : 0;
      return { elbowFlexionDeg: flex, elbowDriftX };
    }, 3);
    const result = runBicepCurlSession(frames);
    expect(countWarnings(result, 'elbow-drift')).toBeGreaterThan(0);
  });

  it('does NOT fire any posture warnings on clean reps (sanity)', () => {
    const frames = makeFrames((t) => ({ elbowFlexionDeg: repFlex(t) }), 3);
    const result = runBicepCurlSession(frames);
    expect(countWarnings(result, 'torso-swing')).toBe(0);
    expect(countWarnings(result, 'elbow-drift')).toBe(0);
    expect(countWarnings(result, 'incomplete-curl')).toBe(0);
  });

  it('momentary torso sway (4 frames) does NOT trigger a warning', () => {
    const frames = makeFrames((t) => {
      const flex = repFlex(t);
      // 4-frame spike (~133ms at 30fps) — below TORSO_SWING_DEBOUNCE_FRAMES=8
      const torsoSwayX = t >= 1200 && t <= 1320 ? 0.06 : 0;
      return { elbowFlexionDeg: flex, torsoSwayX };
    }, 2);
    const result = runBicepCurlSession(frames);
    expect(countWarnings(result, 'torso-swing')).toBe(0);
  });
});
