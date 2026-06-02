/**
 * Nordic Curl — rep validation
 *
 * Tests:
 * - Shallow rep (only 25° lean — below 40°): expect 'incomplete-nordic-curl' + rep still recorded
 * - Ballistic rep (change > 2.5°/frame): expect 'malformed-rep' + rep NOT recorded
 * - Too-short rep (< 500ms): expect 'malformed-rep'
 */
import { describe, it, expect } from 'vitest';
import { buildFrames, concatFrames } from '../../harness/frame-stream';
import { buildNordicCurlPose } from '../../harness/pose-stub';
import { runNordicCurlSession, countWarnings } from '../../harness/runner';
import type { NordicCurlPoseIntent } from '../../harness/types';

const CAL_MS = 2500;

function calFrames() {
  return buildFrames(
    () => ({ trunkLeanDeg: 0, bodyHeight: 0.60 } as NordicCurlPoseIntent),
    buildNordicCurlPose as (i: NordicCurlPoseIntent) => import('@/modules/pose/types').PoseLandmarks,
    { fps: 30, durationMs: CAL_MS },
  );
}

describe('Nordic Curl — rep validation', () => {
  it('emits incomplete-nordic-curl on a shallow rep (25° lean) but still records the rep', () => {
    // Shallow rep: lean only 25° (below 40° threshold)
    const SHALLOW_LEAN = 25;
    const repFrames = buildFrames(
      (t) => {
        const REP_MS = 1600;
        const tInRep = t % REP_MS;
        let lean: number;
        if (tInRep < 600) lean = (tInRep / 600) * SHALLOW_LEAN;
        else if (tInRep < 900) lean = SHALLOW_LEAN;
        else lean = SHALLOW_LEAN - ((tInRep - 900) / 700) * SHALLOW_LEAN;
        return { trunkLeanDeg: Math.max(0, lean), bodyHeight: 0.60 } as NordicCurlPoseIntent;
      },
      buildNordicCurlPose as (i: NordicCurlPoseIntent) => import('@/modules/pose/types').PoseLandmarks,
      { fps: 30, durationMs: 2000 },
    );
    const frames = concatFrames(calFrames(), repFrames);
    const result = runNordicCurlSession(frames);

    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'incomplete-nordic-curl')).toBeGreaterThan(0);
    // Shallow rep still recorded (user gets feedback + credit)
    expect(result.completedReps.length).toBe(1);
  });

  it('emits malformed-rep and does NOT record a ballistic rep', () => {
    // Ballistic rep: very fast (100ms total), triggers velocity > MAX_TRUNK_VELOCITY
    const ballisticFrames = buildFrames(
      (t) => {
        // Quick spike: 0→60° in 50ms, back to 0° in 50ms
        if (t < 50) return { trunkLeanDeg: (t / 50) * 60, bodyHeight: 0.60 } as NordicCurlPoseIntent;
        if (t < 100) return { trunkLeanDeg: 60 - ((t - 50) / 50) * 60, bodyHeight: 0.60 } as NordicCurlPoseIntent;
        return { trunkLeanDeg: 0, bodyHeight: 0.60 } as NordicCurlPoseIntent;
      },
      buildNordicCurlPose as (i: NordicCurlPoseIntent) => import('@/modules/pose/types').PoseLandmarks,
      { fps: 30, durationMs: 800 },
    );
    const frames = concatFrames(calFrames(), ballisticFrames);
    const result = runNordicCurlSession(frames);

    expect(result.finalCalibration?.state).toBe('confirmed');
    // ballistic or too-short → malformed-rep
    const malformedCount = countWarnings(result, 'malformed-rep');
    expect(malformedCount).toBeGreaterThan(0);
    // No reps should be recorded
    expect(result.completedReps.length).toBe(0);
  });

  it('emits malformed-rep for a too-short rep (< 500ms total)', () => {
    // Too-short rep: lean 0→50°→0° in 300ms total
    const shortRepFrames = buildFrames(
      (t) => {
        if (t < 150) return { trunkLeanDeg: (t / 150) * 50, bodyHeight: 0.60 } as NordicCurlPoseIntent;
        if (t < 300) return { trunkLeanDeg: 50 - ((t - 150) / 150) * 50, bodyHeight: 0.60 } as NordicCurlPoseIntent;
        return { trunkLeanDeg: 0, bodyHeight: 0.60 } as NordicCurlPoseIntent;
      },
      buildNordicCurlPose as (i: NordicCurlPoseIntent) => import('@/modules/pose/types').PoseLandmarks,
      { fps: 30, durationMs: 800 },
    );
    const frames = concatFrames(calFrames(), shortRepFrames);
    const result = runNordicCurlSession(frames);

    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'malformed-rep')).toBeGreaterThan(0);
    expect(result.completedReps.length).toBe(0);
  });
});
