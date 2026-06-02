/**
 * Fix A — posture coaching (trunk-forward, leg-not-straight, valgus) must NOT
 * fire while the user rests in STANDING between reps; only during an active rep.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildLateralLungePose } from '../../harness/pose-stub';
import { runLateralLungeSession, countWarnings } from '../../harness/runner';
import type { LateralLungePoseIntent } from '../../harness/types';

const CAL_MS = 2200;

describe('Lateral Lunge — posture warning gating (only fire when not STANDING)', () => {
  it('does NOT fire trunk-forward while STANDING with a sustained trunk lean', () => {
    const frames = buildFrames(
      (tMs): LateralLungePoseIntent => {
        if (tMs < CAL_MS) return { workingKneeFlexionDeg: 0, workingSide: 'left', lateralShift: 0, armsAtSides: true };
        // Still STANDING (both legs straight) but with a sustained trunk lean —
        // it must NOT warn while the user is at rest between reps.
        return {
          workingKneeFlexionDeg: 0,
          straightLegFlexionDeg: 5,
          workingSide: 'left',
          lateralShift: 0,
          armsAtSides: true,
          trunkLeanDeg: 65,
        };
      },
      buildLateralLungePose,
      { fps: 30, durationMs: CAL_MS + 5000 },
    );
    const result = runLateralLungeSession(frames);
    expect(countWarnings(result, 'trunk-forward')).toBe(0);
    expect(countWarnings(result, 'leg-not-straight')).toBe(0);
    expect(countWarnings(result, 'valgus')).toBe(0);
  });

  it('DOES fire trunk-forward once the user enters an active rep with bad form', () => {
    const repCycleMs = 3000;
    const frames = buildFrames(
      (tMs): LateralLungePoseIntent => {
        if (tMs < CAL_MS) return { workingKneeFlexionDeg: 0, workingSide: 'left', lateralShift: 0, armsAtSides: true };
        const tInRep = (tMs - CAL_MS) % repCycleMs;
        let flex: number;
        if (tInRep < 1000) flex = (tInRep / 1000) * 90;
        else if (tInRep < 1500) flex = 90;
        else if (tInRep < 2500) flex = 90 - ((tInRep - 1500) / 1000) * 90;
        else flex = 0;
        const inActive = flex > 25;
        return {
          workingKneeFlexionDeg: flex,
          workingSide: 'left',
          lateralShift: (flex / 90) * 0.14,
          armsAtSides: true,
          trunkLeanDeg: inActive ? 65 : 0,
        };
      },
      buildLateralLungePose,
      { fps: 30, durationMs: CAL_MS + 2 * repCycleMs },
    );
    const result = runLateralLungeSession(frames);
    expect(countWarnings(result, 'trunk-forward')).toBeGreaterThan(0);
  });
});
