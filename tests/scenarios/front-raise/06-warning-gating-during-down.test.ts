/**
 * 2026-05-28 round 21: torso-swing CHIP/SPEECH emission DISABLED for
 * front-raise at engine level (mirror lateral-raise round 20). Tests now
 * verify silence under both rest and active conditions. Form-score still
 * penalises the rep through repFormCounts.torsoOKCount.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildFrontRaisePose } from '../../harness/pose-stub';
import { runFrontRaiseSession, countWarnings } from '../../harness/runner';
import type { FrontRaisePoseIntent } from '../../harness/types';

const CAL_MS = 2200;

describe('Front Raise — posture warning gating (only fire when not DOWN)', () => {
  it('does NOT fire torso-swing while user holds DOWN with sustained sway', () => {
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) return { shoulderFlexionDeg: 0 } as FrontRaisePoseIntent;
        return {
          shoulderFlexionDeg: 0,
          torsoSwayX: 0.06,
        } as FrontRaisePoseIntent;
      },
      buildFrontRaisePose,
      { fps: 30, durationMs: CAL_MS + 5000 },
    );

    const result = runFrontRaiseSession(frames);
    expect(countWarnings(result, 'torso-swing')).toBe(0);
  });

  it('does NOT fire torso-swing during RISING/AT_TOP either (round 21 disable)', () => {
    const repCycleMs = 2800;
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) return { shoulderFlexionDeg: 0 } as FrontRaisePoseIntent;
        const tInRep = (tMs - CAL_MS) % repCycleMs;
        let flex: number;
        if (tInRep < 800) flex = (tInRep / 800) * 95;
        else if (tInRep < 1300) flex = 95;
        else if (tInRep < 2400) flex = 95 - ((tInRep - 1300) / 1100) * 95;
        else flex = 0;
        const inActive = flex > 30;
        return {
          shoulderFlexionDeg: flex,
          torsoSwayX: inActive ? 0.06 : 0,
        } as FrontRaisePoseIntent;
      },
      buildFrontRaisePose,
      { fps: 30, durationMs: CAL_MS + 2 * repCycleMs },
    );

    const result = runFrontRaiseSession(frames);
    expect(countWarnings(result, 'torso-swing')).toBe(0);
  });
});
