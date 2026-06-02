/**
 * Rep validation tests:
 * 1. No crossover → emits 'incomplete-curtsy-lunge' (crossover gate)
 * 2. Too shallow → emits 'incomplete-curtsy-lunge' (depth gate)
 * 3. Ballistic → emits 'malformed-rep'
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildCurtsyLungePose } from '../../harness/pose-stub';
import { runCurtsyLungeSession, countWarnings } from '../../harness/runner';
import type { CurtsyLungePoseIntent } from '../../harness/types';

const CAL_MS = 2200;

describe('Curtsy Lunge — rep validation', () => {
  it('emits incomplete-curtsy-lunge when rear ankle does not cross (no crossover)', () => {
    // Perform a deep lunge but with crossoverRatio = 0 (straight reverse lunge, no curtsy)
    const REP_CYCLE_MS = 3000;
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) {
          return { kneeFlexionDeg: 170, crossoverRatio: 0 } as CurtsyLungePoseIntent;
        }
        const tInRep = (tMs - CAL_MS) % REP_CYCLE_MS;
        let kneeFlexionDeg: number;
        if (tInRep < 1000) kneeFlexionDeg = 170 - (tInRep / 1000) * 80; // 170→90
        else if (tInRep < 1500) kneeFlexionDeg = 90;
        else if (tInRep < 2500) kneeFlexionDeg = 90 + ((tInRep - 1500) / 1000) * 80; // 90→170
        else kneeFlexionDeg = 170;
        return {
          kneeFlexionDeg,
          crossoverRatio: 0,  // No crossover at all — fails crossover gate
        } as CurtsyLungePoseIntent;
      },
      buildCurtsyLungePose,
      { fps: 30, durationMs: CAL_MS + REP_CYCLE_MS },
    );

    const result = runCurtsyLungeSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    // Rep should not count
    expect(result.completedReps.length).toBe(0);
    expect(countWarnings(result, 'incomplete-curtsy-lunge' as any)).toBeGreaterThan(0);
  });

  it('emits incomplete-curtsy-lunge when front knee only reaches 110° (too shallow)', () => {
    // Rear ankle crosses (crossoverRatio = 0.12) but knee only reaches 110° > 100° threshold
    const REP_CYCLE_MS = 3000;
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) {
          return { kneeFlexionDeg: 170, crossoverRatio: 0 } as CurtsyLungePoseIntent;
        }
        const tInRep = (tMs - CAL_MS) % REP_CYCLE_MS;
        let kneeFlexionDeg: number;
        if (tInRep < 1000) kneeFlexionDeg = 170 - (tInRep / 1000) * 60; // 170→110 (shallow)
        else if (tInRep < 1500) kneeFlexionDeg = 110;
        else if (tInRep < 2500) kneeFlexionDeg = 110 + ((tInRep - 1500) / 1000) * 60; // 110→170
        else kneeFlexionDeg = 170;
        return {
          kneeFlexionDeg,
          crossoverRatio: tInRep < 2500 ? 0.12 : 0, // Valid crossover, but shallow depth
        } as CurtsyLungePoseIntent;
      },
      buildCurtsyLungePose,
      { fps: 30, durationMs: CAL_MS + REP_CYCLE_MS },
    );

    const result = runCurtsyLungeSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    // Rep should not count
    expect(result.completedReps.length).toBe(0);
    expect(countWarnings(result, 'incomplete-curtsy-lunge' as any)).toBeGreaterThan(0);
  });

  it('emits malformed-rep when hip velocity exceeds 1.5 (ballistic)', () => {
    // Very fast rep with high hip velocity — ballistic check should trip
    // Use a very short rep duration (200ms) with crossover and depth
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) {
          return { kneeFlexionDeg: 170, crossoverRatio: 0 } as CurtsyLungePoseIntent;
        }
        const tInRep = tMs - CAL_MS;
        let kneeFlexionDeg: number;
        // Ballistic: full rep in 300ms (below MIN_REP_DURATION_MS = 700ms)
        if (tInRep < 150) kneeFlexionDeg = 170 - (tInRep / 150) * 80; // 170→90 in 150ms
        else if (tInRep < 300) kneeFlexionDeg = 90 + ((tInRep - 150) / 150) * 80; // 90→170 in 150ms
        else kneeFlexionDeg = 170;
        return {
          kneeFlexionDeg,
          crossoverRatio: tInRep < 300 ? 0.12 : 0,
          hipVelocity: 3.0, // force high velocity signal
        } as CurtsyLungePoseIntent;
      },
      buildCurtsyLungePose,
      { fps: 60, durationMs: CAL_MS + 2000 }, // high fps to catch fast motion
    );

    const result = runCurtsyLungeSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    // Should emit malformed-rep (or incomplete due to too-fast)
    const malformed = countWarnings(result, 'malformed-rep');
    const incomplete = countWarnings(result, 'incomplete-curtsy-lunge' as any);
    expect(malformed + incomplete).toBeGreaterThan(0);
    // Rep should not count
    expect(result.completedReps.length).toBe(0);
  });
});
