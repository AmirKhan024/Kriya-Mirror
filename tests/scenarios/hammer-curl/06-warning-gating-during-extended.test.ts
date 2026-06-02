/**
 * Fix A regression: posture warnings (torso-swing, elbow-drift) must NOT fire
 * while the user rests in EXTENDED between reps. They should only fire during
 * active rep phases (CURLING / AT_TOP / LOWERING).
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildHammerCurlPose } from '../../harness/pose-stub';
import { runHammerCurlSession, countWarnings } from '../../harness/runner';
import type { HammerCurlPoseIntent } from '../../harness/types';

const CAL_MS = 2200;

describe('Hammer Curl — posture warning gating (only fire when not EXTENDED)', () => {
  it('does NOT fire torso-swing while user holds EXTENDED with bad form', () => {
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) return { elbowFlexionDeg: 0 } as HammerCurlPoseIntent;
        return {
          elbowFlexionDeg: 0,
          torsoSwayX: 0.06,    // past TORSO_SWING_THRESHOLD=0.04
        } as HammerCurlPoseIntent;
      },
      buildHammerCurlPose,
      { fps: 30, durationMs: CAL_MS + 5000 },
    );

    const result = runHammerCurlSession(frames);

    expect(countWarnings(result, 'torso-swing')).toBe(0);
    expect(countWarnings(result, 'elbow-drift')).toBe(0);
  });

  it('DOES fire torso-swing once the user enters CURLING with bad form', () => {
    const repCycleMs = 3000;
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) return { elbowFlexionDeg: 0 } as HammerCurlPoseIntent;
        const tInRep = (tMs - CAL_MS) % repCycleMs;
        let elbowFlexionDeg: number;
        if (tInRep < 1000) elbowFlexionDeg = (tInRep / 1000) * 130;
        else if (tInRep < 1500) elbowFlexionDeg = 130;
        else if (tInRep < 2500) elbowFlexionDeg = 130 - ((tInRep - 1500) / 1000) * 130;
        else elbowFlexionDeg = 0;
        const inActive = elbowFlexionDeg > 30;
        return {
          elbowFlexionDeg,
          torsoSwayX: inActive ? 0.06 : 0,
        } as HammerCurlPoseIntent;
      },
      buildHammerCurlPose,
      { fps: 30, durationMs: CAL_MS + 2 * repCycleMs },
    );

    const result = runHammerCurlSession(frames);
    expect(countWarnings(result, 'torso-swing')).toBeGreaterThan(0);
  });
});
