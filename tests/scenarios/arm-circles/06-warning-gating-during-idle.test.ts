/**
 * 2026-05-28 round 21: torso-swing CHIP/SPEECH emission DISABLED for
 * arm-circles at engine level (mirror lateral-raise round 20). Tests now
 * verify silence under both rest and active conditions. Form-score still
 * penalises through repFormCounts.torsoOKCount.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildArmCirclesPose } from '../../harness/pose-stub';
import { runArmCirclesSession, countWarnings } from '../../harness/runner';
import type { ArmCirclesPoseIntent } from '../../harness/types';

const CAL_MS = 2200;

describe('Arm Circles — posture warning gating (only fire when not DOWN)', () => {
  it('does NOT fire torso-swing while user holds DOWN with sustained sway', () => {
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) return { abductionDeg: 0 } as ArmCirclesPoseIntent;
        return {
          abductionDeg: 0,
          torsoSwayX: 0.06,
        } as ArmCirclesPoseIntent;
      },
      buildArmCirclesPose,
      { fps: 30, durationMs: CAL_MS + 5000 },
    );

    const result = runArmCirclesSession(frames);
    expect(countWarnings(result, 'torso-swing')).toBe(0);
  });

  it('does NOT fire torso-swing during RISING/AT_TOP either (round 21 disable)', () => {
    const repCycleMs = 3000;
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) return { abductionDeg: 0 } as ArmCirclesPoseIntent;
        const t = (tMs - CAL_MS) % repCycleMs;
        let abd: number;
        if (t < 900) abd = (t / 900) * 160;
        else if (t < 1500) abd = 160;
        else if (t < 2700) abd = 160 - ((t - 1500) / 1200) * 160;
        else abd = 0;
        const inActive = abd > 30;
        return {
          abductionDeg: abd,
          torsoSwayX: inActive ? 0.06 : 0,
        } as ArmCirclesPoseIntent;
      },
      buildArmCirclesPose,
      { fps: 30, durationMs: CAL_MS + 2 * repCycleMs },
    );

    const result = runArmCirclesSession(frames);
    expect(countWarnings(result, 'torso-swing')).toBe(0);
  });
});
