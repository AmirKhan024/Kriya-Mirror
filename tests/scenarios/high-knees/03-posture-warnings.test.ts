import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildHighKneesPose } from '../../harness/pose-stub';
import { runHighKneesSession, countWarnings } from '../../harness/runner';
import type { HighKneesPoseIntent } from '../../harness/types';

const CAL_MS = 2200;
// 2026-05-28 round 23: cycle lengthened 1000 → 1400 ms and peak intent raised
// 50 → 70 % to give EMA-smoothed signal time to drop below LOW_THRESHOLD=15
// on the descending side before the rising side takes over (higher peak ⇒
// slower EMA decay in absolute terms).
const cycleMs = 1400;

function repCycle(t: number): { leftKneeLiftPct: number; rightKneeLiftPct: number } {
  let left: number, right: number;
  if (t < 350) { left = (t / 350) * 70; right = 0; }
  else if (t < 700) { left = 70; right = 0; }
  else if (t < 1050) {
    const u = (t - 700) / 350;
    left = 70 * (1 - u); right = 70 * u;
  }
  else if (t < 1300) { left = 0; right = 70; }
  else { left = 0; right = 70 * (1 - (t - 1300) / 100); }
  return { leftKneeLiftPct: left, rightKneeLiftPct: right };
}

function makeFrames(intentAt: (tInCycle: number) => Partial<HighKneesPoseIntent>, cycles = 3) {
  return buildFrames(
    (tMs) => {
      if (tMs < CAL_MS) return { leftKneeLiftPct: 0, rightKneeLiftPct: 0 } as HighKneesPoseIntent;
      const tInCycle = (tMs - CAL_MS) % cycleMs;
      return { leftKneeLiftPct: 0, rightKneeLiftPct: 0, ...intentAt(tInCycle) } as HighKneesPoseIntent;
    },
    buildHighKneesPose,
    { fps: 30, durationMs: CAL_MS + cycles * cycleMs + 500 },
  );
}

describe('High Knees — posture warnings', () => {
  // 2026-05-28 round 21: torso-swing chip/speech emission DISABLED at engine
  // level. Natural high-knee cadence shifts shoulder mid X laterally as the
  // body counter-balances rapid knee lifts.
  it('does NOT fire torso-swing chip even with sustained sway (round 21 disable)', () => {
    const frames = makeFrames((t) => {
      const cycle = repCycle(t);
      const activelyMoving = cycle.leftKneeLiftPct > 5 || cycle.rightKneeLiftPct > 5;
      const torsoSwayX = activelyMoving ? 0.06 : 0;
      return { ...cycle, torsoSwayX };
    }, 3);
    const result = runHighKneesSession(frames);
    expect(countWarnings(result, 'torso-swing')).toBe(0);
  });

  it('does NOT fire posture warnings on clean reps (sanity)', () => {
    const frames = makeFrames((t) => repCycle(t), 3);
    const result = runHighKneesSession(frames);
    expect(countWarnings(result, 'torso-swing')).toBe(0);
    expect(countWarnings(result, 'low-knee-lift')).toBe(0);
  });
});
