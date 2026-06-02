import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildJumpingJacksPose } from '../../harness/pose-stub';
import { runJumpingJacksSession, countWarnings } from '../../harness/runner';
import type { JumpingJacksPoseIntent } from '../../harness/types';

const CAL_MS = 2200;

function makeFrames(repCycle: (tInRep: number) => Partial<JumpingJacksPoseIntent>, reps: number, repCycleMs: number) {
  return buildFrames(
    (tMs) => {
      if (tMs < CAL_MS) return { armOpennessPct: 0, legOpennessPct: 30 } as JumpingJacksPoseIntent;
      const tInRep = (tMs - CAL_MS) % repCycleMs;
      return { armOpennessPct: 0, legOpennessPct: 30, ...repCycle(tInRep) } as JumpingJacksPoseIntent;
    },
    buildJumpingJacksPose,
    { fps: 30, durationMs: CAL_MS + reps * repCycleMs + 500 },
  );
}

describe('Jumping Jacks — rep validation gates', () => {
  it('rejects half-jacks where feet barely separate (legs lagging arms)', () => {
    // Arms go very high (130 % — enough EMA headroom over OPEN_THRESHOLD=70),
    // feet barely separate (legPct peaks at 45). Composite raw ≈ (130 + 45)/2 = 87.5,
    // well above OPEN_THRESHOLD. State enters OPEN, then legPeak=45 < MIN_REP_OPENNESS=50
    // → too-shallow → incomplete-jack.
    const frames = makeFrames(
      (t) => {
        let arm: number, leg: number;
        if (t < 500) { arm = (t / 500) * 130; leg = 30 + (t / 500) * 15; }
        else if (t < 1200) { arm = 130; leg = 45; }
        else if (t < 1700) { arm = 130 - ((t - 1200) / 500) * 130; leg = 45 - ((t - 1200) / 500) * 15; }
        else { arm = 0; leg = 30; }
        return { armOpennessPct: arm, legOpennessPct: leg };
      },
      3,
      2500,
    );
    const result = runJumpingJacksSession(frames);
    expect(result.completedReps.length).toBe(0);
    expect(countWarnings(result, 'incomplete-jack')).toBeGreaterThan(0);
  });

  it('rejects unilateral jacks (left arm raises, right arm stays down)', () => {
    // Composite high enough to trigger OPEN (left arm fully up + feet apart),
    // but peakLeftArm (100) / peakRightArm (5) ratio = 0.05 → unilateral.
    const frames = makeFrames(
      (t) => {
        let arm: number, leg: number;
        if (t < 500) { arm = (t / 500) * 100; leg = 30 + (t / 500) * 70; }
        else if (t < 1000) { arm = 100; leg = 100; }
        else if (t < 1500) { arm = 100 - ((t - 1000) / 500) * 100; leg = 100 - ((t - 1000) / 500) * 70; }
        else { arm = 0; leg = 30; }
        return {
          armOpennessPct: arm,
          legOpennessPct: leg,
          leftArmOpennessPct: arm,
          rightArmOpennessPct: arm * 0.05,    // right arm barely moves
        };
      },
      3,
      2000,
    );
    const result = runJumpingJacksSession(frames);
    expect(result.completedReps.length).toBe(0);
  });

  it('accepts valid reps just above the minimum-openness boundary', () => {
    // Peak armPct = 85, peak legPct = 85 → composite raw = 85, with EMA
    // headroom easily clearing OPEN_THRESHOLD=70. Both peaks ≥
    // MIN_REP_OPENNESS (50) → accepted.
    const frames = makeFrames(
      (t) => {
        let arm: number, leg: number;
        if (t < 500) { arm = (t / 500) * 85; leg = 30 + (t / 500) * 55; }
        else if (t < 1200) { arm = 85; leg = 85; }
        else if (t < 1700) { arm = 85 - ((t - 1200) / 500) * 85; leg = 85 - ((t - 1200) / 500) * 55; }
        else { arm = 0; leg = 30; }
        return { armOpennessPct: arm, legOpennessPct: leg };
      },
      3,
      2500,
    );
    const result = runJumpingJacksSession(frames);
    expect(result.completedReps.length).toBe(3);
  });
});
