import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildPushupPose } from '../../harness/pose-stub';
import { runPushupSession, countWarnings } from '../../harness/runner';
import type { PushupPoseIntent } from '../../harness/types';

const CAL_MS = 2200;

function makeFrames(repCycle: (tInRep: number) => Partial<PushupPoseIntent>, reps = 3, repCycleMs = 3000) {
  return buildFrames(
    (tMs) => {
      if (tMs < CAL_MS) return { elbowFlexionDeg: 0, side: 'left' as const } as PushupPoseIntent;
      const tInRep = (tMs - CAL_MS) % repCycleMs;
      return { elbowFlexionDeg: 0, side: 'left' as const, ...repCycle(tInRep) } as PushupPoseIntent;
    },
    buildPushupPose,
    { fps: 30, durationMs: CAL_MS + reps * repCycleMs + 500 },
  );
}

function repFlex(t: number, peak = 90): number {
  if (t < 1000) return (t / 1000) * peak;
  if (t < 1500) return peak;
  if (t < 2500) return peak - ((t - 1500) / 1000) * peak;
  return 0;
}

describe('Push-Up — posture warnings', () => {
  it('fires hip-sag warning when hips drop persistently past threshold', () => {
    const frames = makeFrames((t) => {
      const flex = repFlex(t);
      // Hold a sag (hipDelta=0.06, past HIP_SAG_THRESHOLD=0.04) during the active phase
      const hipDelta = flex > 30 ? 0.06 : 0;
      return { elbowFlexionDeg: flex, hipDelta };
    }, 3);
    const result = runPushupSession(frames);
    expect(countWarnings(result, 'hip-sag')).toBeGreaterThan(0);
  });

  it('fires hip-pike warning when hips rise persistently past threshold', () => {
    const frames = makeFrames((t) => {
      const flex = repFlex(t);
      const hipDelta = flex > 30 ? -0.06 : 0;
      return { elbowFlexionDeg: flex, hipDelta };
    }, 3);
    const result = runPushupSession(frames);
    expect(countWarnings(result, 'hip-pike')).toBeGreaterThan(0);
  });

  it('does NOT false-fire elbow-flare (side-view detection disabled)', () => {
    // Elbow-flare detection requires a front camera; the side-view 2D engine
    // intentionally never emits this warning. The test guards against future
    // regressions where someone re-enables the detection without a proper
    // 3D-aware metric. See .context/03_KNOWN_ISSUES_TO_PREVENT.md → B8.
    const frames = makeFrames((t) => {
      const flex = repFlex(t);
      return { elbowFlexionDeg: flex, elbowFlare: flex >= 60 };
    }, 3);
    const result = runPushupSession(frames);
    expect(countWarnings(result, 'elbow-flare')).toBe(0);
  });

  it('does NOT fire any posture warnings on a clean rep (sanity)', () => {
    const frames = makeFrames((t) => ({ elbowFlexionDeg: repFlex(t) }), 3);
    const result = runPushupSession(frames);
    expect(countWarnings(result, 'hip-sag')).toBe(0);
    expect(countWarnings(result, 'hip-pike')).toBe(0);
    expect(countWarnings(result, 'elbow-flare')).toBe(0);
    expect(countWarnings(result, 'spine-misaligned')).toBe(0);
  });

  it('momentary hip sag (4 frames) does NOT trigger a warning', () => {
    const frames = makeFrames((t) => {
      const flex = repFlex(t);
      // Sag for ~4 frames only (< HIP_DEBOUNCE_FRAMES=6)
      const hipDelta = t >= 1200 && t <= 1320 ? 0.06 : 0;
      return { elbowFlexionDeg: flex, hipDelta };
    }, 2);
    const result = runPushupSession(frames);
    expect(countWarnings(result, 'hip-sag')).toBe(0);
  });
});
