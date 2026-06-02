/**
 * Regression test for the shoulder-descent gate (2026-05-31).
 *
 * The engine must reject reps where the torso doesn't descend, even when
 * elbow flexion correctly cycles through the dip window. This catches the
 * real-world bug where sitting and bending arms (not performing a dip)
 * incremented the rep counter.
 *
 * Test A: arm-only movement (shoulderDescentY=0) → 0 reps, ≥1 malformed-rep warning
 * Test B: symmetric dip with shoulder descent (shoulderDescentY ramps to 0.04) → ≥2 reps
 * Test C: partial descent only reaches 0.01 (< 0.02 threshold) → 0 reps, ≥1 malformed-rep
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildChairDipPose } from '../../harness/pose-stub';
import { runChairDipSession, countWarnings } from '../../harness/runner';
import type { ChairDipPoseIntent } from '../../harness/types';

const CAL_MS = 500;

describe('Chair Dip — no-body-movement rejection gate', () => {
  it('Test A: symmetric elbow flex cycle with ZERO shoulder descent → 0 reps, fires malformed-rep', () => {
    const repCycleMs = 3000;
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) {
          return { elbowFlexionDeg: 5, feetWidthRatio: 1.0, bodyHeight: 0.70 } as ChairDipPoseIntent;
        }
        const tInRep = (tMs - CAL_MS) % repCycleMs;
        let flex: number;
        if (tInRep < 1000) flex = 5 + (tInRep / 1000) * 85;
        else if (tInRep < 1500) flex = 90;
        else if (tInRep < 2500) flex = 90 - ((tInRep - 1500) / 1000) * 85;
        else flex = 5;
        return {
          elbowFlexionDeg: flex,
          feetWidthRatio: 1.0,
          bodyHeight: 0.70,
          shoulderDescentY: 0,
        } as ChairDipPoseIntent;
      },
      buildChairDipPose,
      { fps: 30, durationMs: CAL_MS + 3 * repCycleMs },
    );

    const result = runChairDipSession(frames);
    expect(result.completedReps.length).toBe(0);
    expect(countWarnings(result, 'malformed-rep')).toBeGreaterThan(0);
  });

  it('Test B: symmetric dip with proper shoulder descent → reps are counted normally', () => {
    const repCycleMs = 3000;
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) {
          return { elbowFlexionDeg: 5, feetWidthRatio: 1.0, bodyHeight: 0.70 } as ChairDipPoseIntent;
        }
        const tInRep = (tMs - CAL_MS) % repCycleMs;
        let flex: number;
        if (tInRep < 1000) flex = 5 + (tInRep / 1000) * 85;
        else if (tInRep < 1500) flex = 90;
        else if (tInRep < 2500) flex = 90 - ((tInRep - 1500) / 1000) * 85;
        else flex = 5;
        const descent = Math.max(0, Math.min(0.04, (flex - 5) / 85 * 0.04));
        return {
          elbowFlexionDeg: flex,
          feetWidthRatio: 1.0,
          bodyHeight: 0.70,
          shoulderDescentY: descent,
        } as ChairDipPoseIntent;
      },
      buildChairDipPose,
      { fps: 30, durationMs: CAL_MS + 3 * repCycleMs + 500 },
    );

    const result = runChairDipSession(frames);
    expect(result.completedReps.length).toBeGreaterThanOrEqual(2);
  });

  it('Test C: partial descent (0.01, below 0.02 threshold) → 0 reps, fires malformed-rep', () => {
    const repCycleMs = 3000;
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) {
          return { elbowFlexionDeg: 5, feetWidthRatio: 1.0, bodyHeight: 0.70 } as ChairDipPoseIntent;
        }
        const tInRep = (tMs - CAL_MS) % repCycleMs;
        let flex: number;
        if (tInRep < 1000) flex = 5 + (tInRep / 1000) * 85;
        else if (tInRep < 1500) flex = 90;
        else if (tInRep < 2500) flex = 90 - ((tInRep - 1500) / 1000) * 85;
        else flex = 5;
        // Cap descent at 0.01 — just under the MIN_SHOULDER_DESCENT=0.02 gate
        const descent = Math.max(0, Math.min(0.01, (flex - 5) / 85 * 0.01));
        return {
          elbowFlexionDeg: flex,
          feetWidthRatio: 1.0,
          bodyHeight: 0.70,
          shoulderDescentY: descent,
        } as ChairDipPoseIntent;
      },
      buildChairDipPose,
      { fps: 30, durationMs: CAL_MS + 3 * repCycleMs },
    );

    const result = runChairDipSession(frames);
    expect(result.completedReps.length).toBe(0);
    expect(countWarnings(result, 'malformed-rep')).toBeGreaterThan(0);
  });
});
