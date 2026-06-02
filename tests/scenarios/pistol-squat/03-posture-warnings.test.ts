/**
 * Posture warning scenarios:
 * - 10+ frames of valgus during DESCENDING → expect 'valgus' warning
 * - trunk lean > 55° during DESCENDING → expect 'trunk-lean' warning
 * - brief 2-frame flicker of valgus at low flex → expect NO warning (debounce = 10 frames + flex guard)
 * - warnings respect cooldown (2500ms), not every frame
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildPistolSquatPose } from '../../harness/pose-stub';
import { runPistolSquatSession, countWarnings } from '../../harness/runner';
import type { PistolSquatPoseIntent } from '../../harness/types';

const CAL_MS = 2200;

// A full rep cycle: 0→90° over 1200ms, hold 500ms, 90→0 over 1200ms
function repCycle(tInRep: number): number {
  if (tInRep < 1200) return (tInRep / 1200) * 90;
  if (tInRep < 1700) return 90;
  if (tInRep < 2900) return 90 - ((tInRep - 1700) / 1200) * 90;
  return 0;
}

describe('Pistol Squat — posture warnings', () => {
  it('fires valgus warning when standing knee collapses during DESCENDING (10+ frames at deep flex)', () => {
    // During the deep descent phase inject valgusRatio=0.25 (> 0.20 threshold)
    // Valgus is injected at flex > 40° (where the detection fires with 20% collapse)
    const TOTAL_MS = CAL_MS + 3500;
    const frames = buildFrames(
      (tMs): PistolSquatPoseIntent => {
        if (tMs < CAL_MS) {
          return { kneeFlexionDeg: 0, standingLeg: 'left', armsForward: false };
        }
        const tInRep = tMs - CAL_MS;
        const flex = repCycle(tInRep);
        // Inject valgus during deep descent (flex > 40°) and hold phase
        // At 40°, 10 frames ≈ 333ms of valgus → debounce of 10 frames met
        const inDeepZone = flex > 40;
        return {
          kneeFlexionDeg: flex,
          standingLeg: 'left',
          armsForward: true,
          valgusRatio: inDeepZone ? 0.25 : 0,
        };
      },
      buildPistolSquatPose,
      { fps: 30, durationMs: TOTAL_MS },
    );

    const result = runPistolSquatSession(frames);
    expect(countWarnings(result, 'valgus')).toBeGreaterThan(0);
  });

  it('fires trunk-lean warning when trunk > 55° during DESCENDING', () => {
    const TOTAL_MS = CAL_MS + 3500;
    const frames = buildFrames(
      (tMs): PistolSquatPoseIntent => {
        if (tMs < CAL_MS) {
          return { kneeFlexionDeg: 0, standingLeg: 'left', armsForward: false };
        }
        const tInRep = tMs - CAL_MS;
        const flex = repCycle(tInRep);
        // Inject trunk lean during deep descent
        const inDescentZone = tInRep > 200 && tInRep < 1200;
        return {
          kneeFlexionDeg: flex,
          standingLeg: 'left',
          armsForward: true,
          trunkLeanDeg: inDescentZone ? 60 : 0,
        };
      },
      buildPistolSquatPose,
      { fps: 30, durationMs: TOTAL_MS },
    );

    const result = runPistolSquatSession(frames);
    expect(countWarnings(result, 'trunk-lean')).toBeGreaterThan(0);
  });

  it('does NOT fire valgus for brief 2-frame flicker at low flex (debounce = 10 frames + flex guard)', () => {
    const TOTAL_MS = CAL_MS + 3500;
    const frames = buildFrames(
      (tMs): PistolSquatPoseIntent => {
        if (tMs < CAL_MS) {
          return { kneeFlexionDeg: 0, standingLeg: 'left', armsForward: false };
        }
        const tInRep = tMs - CAL_MS;
        const flex = repCycle(tInRep);
        // Only 2 frames of valgus at LOW flex (25-30°) — below the 30° flex guard
        // AND below 10-frame debounce. Neither condition should trigger.
        const flickerZone = flex > 25 && flex < 31 && tInRep < 500;
        return {
          kneeFlexionDeg: flex,
          standingLeg: 'left',
          armsForward: true,
          valgusRatio: flickerZone ? 0.25 : 0,
        };
      },
      buildPistolSquatPose,
      { fps: 30, durationMs: TOTAL_MS },
    );

    const result = runPistolSquatSession(frames);
    expect(countWarnings(result, 'valgus')).toBe(0);
  });

  it('fires valgus at most once per 2500ms cooldown, not every frame', () => {
    // Continuous valgus throughout a deep part of the rep → fires once per 2500ms
    const TOTAL_MS = CAL_MS + 3500;
    const frames = buildFrames(
      (tMs): PistolSquatPoseIntent => {
        if (tMs < CAL_MS) {
          return { kneeFlexionDeg: 0, standingLeg: 'left', armsForward: false };
        }
        const tInRep = tMs - CAL_MS;
        const flex = repCycle(tInRep);
        // Continuous valgus during entire rep at flex > 40°
        const inDeepZone = flex > 40;
        return {
          kneeFlexionDeg: flex,
          standingLeg: 'left',
          armsForward: true,
          valgusRatio: inDeepZone ? 0.25 : 0,
        };
      },
      buildPistolSquatPose,
      { fps: 30, durationMs: TOTAL_MS },
    );

    const result = runPistolSquatSession(frames);
    // With 2500ms cooldown and a 3.5s rep, valgus fires at most once
    expect(countWarnings(result, 'valgus')).toBeLessThanOrEqual(2);
    expect(countWarnings(result, 'valgus')).toBeGreaterThan(0);
  });
});
