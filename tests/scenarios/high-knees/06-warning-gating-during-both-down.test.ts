/**
 * 2026-05-28 round 21: torso-swing CHIP/SPEECH emission DISABLED for
 * high-knees at engine level (mirror lateral-raise round 20). Tests now
 * verify silence under both rest and active conditions. Form-score still
 * penalises the rep through repFormCounts.torsoOKCount.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildHighKneesPose } from '../../harness/pose-stub';
import { runHighKneesSession, countWarnings } from '../../harness/runner';
import type { HighKneesPoseIntent } from '../../harness/types';

const CAL_MS = 2200;

describe('High Knees — posture warning gating (only fire when not BOTH_DOWN)', () => {
  it('does NOT fire torso-swing while user holds BOTH_DOWN with sustained sway', () => {
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) return { leftKneeLiftPct: 0, rightKneeLiftPct: 0 } as HighKneesPoseIntent;
        return {
          leftKneeLiftPct: 0,
          rightKneeLiftPct: 0,
          torsoSwayX: 0.06,
        } as HighKneesPoseIntent;
      },
      buildHighKneesPose,
      { fps: 30, durationMs: CAL_MS + 5000 },
    );

    const result = runHighKneesSession(frames);
    expect(countWarnings(result, 'torso-swing')).toBe(0);
  });

  it('does NOT fire torso-swing during UP state either (round 21 disable)', () => {
    const cycleMs = 1000;
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) return { leftKneeLiftPct: 0, rightKneeLiftPct: 0 } as HighKneesPoseIntent;
        const tInCycle = (tMs - CAL_MS) % cycleMs;
        let left: number, right: number;
        if (tInCycle < 300) { left = (tInCycle / 300) * 70; right = 0; }
        else if (tInCycle < 500) { left = 70; right = 0; }
        else if (tInCycle < 700) {
          const u = (tInCycle - 500) / 200;
          left = 70 * (1 - u); right = 70 * u;
        }
        else if (tInCycle < 900) { left = 0; right = 70; }
        else { left = 0; right = 70 * (1 - (tInCycle - 900) / 100); }
        const inActive = left > 5 || right > 5;
        return {
          leftKneeLiftPct: left,
          rightKneeLiftPct: right,
          torsoSwayX: inActive ? 0.06 : 0,
        } as HighKneesPoseIntent;
      },
      buildHighKneesPose,
      { fps: 30, durationMs: CAL_MS + 3 * cycleMs },
    );

    const result = runHighKneesSession(frames);
    expect(countWarnings(result, 'torso-swing')).toBe(0);
  });
});
