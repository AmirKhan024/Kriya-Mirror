import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildLateralRaisePose } from '../../harness/pose-stub';
import { runLateralRaiseSession, countWarnings } from '../../harness/runner';
import type { LateralRaisePoseIntent } from '../../harness/types';

const CAL_MS = 2200;

function makeFrames(repCycle: (tInRep: number) => Partial<LateralRaisePoseIntent>, reps = 3, repCycleMs = 3000) {
  return buildFrames(
    (tMs) => {
      if (tMs < CAL_MS) return { abductionDeg: 0 } as LateralRaisePoseIntent;
      const tInRep = (tMs - CAL_MS) % repCycleMs;
      return { abductionDeg: 0, ...repCycle(tInRep) } as LateralRaisePoseIntent;
    },
    buildLateralRaisePose,
    { fps: 30, durationMs: CAL_MS + reps * repCycleMs + 500 },
  );
}

function repAbd(t: number, peak = 88): number {
  if (t < 1000) return (t / 1000) * peak;
  if (t < 1500) return peak;
  if (t < 2500) return peak - ((t - 1500) / 1000) * peak;
  return 0;
}

describe('Lateral Raise — posture warnings', () => {
  // 2026-05-28 round 20: torso-swing CHIP/SPEECH emission is now DISABLED for
  // lateral-raise (form-score still penalizes shoulder drift, but the user no
  // longer sees the bicep-curl-styled chip during normal lateral raises).
  it('does NOT emit torso-swing chip during lateral raise (round 20 disabled)', () => {
    const frames = makeFrames((t) => {
      const abd = repAbd(t);
      // Deliberate 6% shoulder-X sway — well past the old 0.04 threshold.
      const torsoSwayX = abd > 30 ? 0.06 : 0;
      return { abductionDeg: abd, torsoSwayX };
    }, 3);
    const result = runLateralRaiseSession(frames);
    expect(countWarnings(result, 'torso-swing')).toBe(0);
  });

  it('fires arm-asymmetry warning on a clearly-asymmetric rep (≥25° L/R diff)', () => {
    // Round 20: ARM_ASYMMETRY_DEG bumped 15 → 25. Use 70° vs 110° → 40° diff,
    // avg 90° (passes too-shallow and is in valid arms-too-high range),
    // wrists outward (passes arms-forward-not-side). Only asymmetric fires.
    const frames = makeFrames((t) => {
      const right = repAbd(t, 110);
      const left = repAbd(t, 70);
      return { abductionDeg: 0, leftAbductionDeg: left, rightAbductionDeg: right };
    }, 3);
    const result = runLateralRaiseSession(frames);
    expect(countWarnings(result, 'arm-asymmetry')).toBeGreaterThan(0);
  });

  it('does NOT fire any posture warnings on clean reps (sanity)', () => {
    const frames = makeFrames((t) => ({ abductionDeg: repAbd(t) }), 3);
    const result = runLateralRaiseSession(frames);
    expect(countWarnings(result, 'torso-swing')).toBe(0);
    expect(countWarnings(result, 'arm-asymmetry')).toBe(0);
    expect(countWarnings(result, 'incomplete-raise')).toBe(0);
  });

  // 2026-05-28 round 20: with torso-swing emission disabled, the engine still
  // tracks the per-frame condition for form-score, but no chip ever fires —
  // so this test (which was a debounce-protection check pre-round-20) is now
  // covered by the broader "does NOT emit" assertion above. Keeping it here
  // as a sanity check that the disable is total, not partial.
  it('momentary torso sway also does not trigger a warning (full disable)', () => {
    const frames = makeFrames((t) => {
      const abd = repAbd(t);
      const torsoSwayX = t >= 1200 && t <= 1320 ? 0.06 : 0;
      return { abductionDeg: abd, torsoSwayX };
    }, 2);
    const result = runLateralRaiseSession(frames);
    expect(countWarnings(result, 'torso-swing')).toBe(0);
  });
});
