import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildHighKneesPose } from '../../harness/pose-stub';
import { runHighKneesSession, countWarnings } from '../../harness/runner';
import type { HighKneesPoseIntent } from '../../harness/types';

const CAL_MS = 2200;

function makeFrames(intentAt: (tInRep: number) => Partial<HighKneesPoseIntent>, cycles: number, cycleMs = 1000) {
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

describe('High Knees — rep validation gates', () => {
  it('rejects shallow reps (peak knee lift < MIN_REP_HEIGHT_PCT=50)', () => {
    // 2026-05-28 round 23: threshold raised 30 → 50. Peak intent = 22 stays
    // well below HIGH=25 and the new MIN_REP_HEIGHT=50 floor — no rep should
    // be counted.
    const frames = makeFrames((t) => {
      let left: number, right: number;
      if (t < 600) { left = (t / 600) * 22; right = 0; }
      else if (t < 1000) { left = 22; right = 0; }
      else if (t < 1500) {
        const u = (t - 1000) / 500;
        left = 22 * (1 - u); right = 22 * u;
      }
      else if (t < 1900) { left = 0; right = 22; }
      else { left = 0; right = 22 * (1 - (t - 1900) / 100); }
      return { leftKneeLiftPct: left, rightKneeLiftPct: right };
    }, 4, 2000);
    const result = runHighKneesSession(frames);
    expect(result.completedReps.length).toBeLessThanOrEqual(2);
  });

  it('fires low-knee-lift when peak crosses HIGH but stays below MIN_REP_HEIGHT (round 23)', () => {
    // 2026-05-28 round 23: peak intent = 40 clears HIGH_THRESHOLD=25 (state
    // enters UP) but raw peak < new MIN_REP_HEIGHT=50 → too-shallow → fires
    // low-knee-lift. Pre-round-23 this used 27 (just above the old 25-30
    // window); the new gap requires a higher peak to enter the state.
    const frames = makeFrames((t) => {
      let left: number, right: number;
      if (t < 500) { left = (t / 500) * 40; right = 0; }
      else if (t < 900) { left = 40; right = 0; }
      else if (t < 1300) {
        const u = (t - 900) / 400;
        left = 40 * (1 - u); right = 40 * u;
      }
      else if (t < 1700) { left = 0; right = 40; }
      else { left = 0; right = 40 * (1 - (t - 1700) / 100); }
      return { leftKneeLiftPct: left, rightKneeLiftPct: right };
    }, 3, 1800);
    const result = runHighKneesSession(frames);
    expect(countWarnings(result, 'low-knee-lift')).toBeGreaterThan(0);
  });

  it('accepts valid reps at the boundary (~55% peak lift)', () => {
    // 2026-05-28 round 23: boundary intent raised 35 → 55 (just above the new
    // MIN_REP_HEIGHT_PCT=50 floor). Validates the new threshold behavior.
    const frames = makeFrames((t) => {
      let left: number, right: number;
      if (t < 400) { left = (t / 400) * 55; right = 0; }
      else if (t < 700) { left = 55; right = 0; }
      else if (t < 1100) {
        const u = (t - 700) / 400;
        left = 55 * (1 - u); right = 55 * u;
      }
      else if (t < 1400) { left = 0; right = 55; }
      else { left = 0; right = 55 * (1 - (t - 1400) / 100); }
      return { leftKneeLiftPct: left, rightKneeLiftPct: right };
    }, 4, 1500);
    const result = runHighKneesSession(frames);
    expect(result.completedReps.length).toBeGreaterThanOrEqual(4);
  });

  // 2026-05-28 round 21 regression — physical-test log:
  // [KNEES][REP] depthDeg:335.9 / 366 / 365
  // MediaPipe knee landmark mis-localized at the shoulder during fast motion
  // produced raw lift values of 300%+ which became absurd depthDeg readouts.
  // Round 21 clamps the per-rep peak at MAX_REASONABLE_KNEE_LIFT_PCT=120.
  // The rep is still counted (real motion underneath the outlier), but the
  // reported depthDeg never exceeds 120.
  it('clamps absurd MediaPipe knee outliers — no rep with depthDeg > 120 (round 21)', () => {
    // Drive the knee lift to a sustained 200% (impossible MediaPipe outlier).
    // Pre-round-21: rep would complete with depthDeg ≈ 200.
    // Round-21:    clamp kicks in, peak caps at 120 in the rep payload.
    const frames = makeFrames((t) => {
      let left: number;
      if (t < 600) left = (t / 600) * 200;
      else if (t < 1200) left = 200;
      else if (t < 1800) left = 200 - ((t - 1200) / 600) * 200;
      else left = 0;
      return { leftKneeLiftPct: left, rightKneeLiftPct: 0 };
    }, 3, 2000);
    const result = runHighKneesSession(frames);
    for (const rep of result.completedReps) {
      expect(rep.depthDeg).toBeLessThanOrEqual(120);
    }
  });

  // 2026-05-28 round 22 regression — physical-test log:
  // CALIB CONFIRMED at t=236075, first ghost REP at t=237118 (~1 s later)
  // with depthDeg:55.7 even though the user reported NOT lifting yet. EMA
  // seed noise immediately post-cal-confirm crossed HIGH_THRESHOLD=25 and
  // the state machine fired a rep. Round 22 adds MIN_TIME_AFTER_CAL_MS=500
  // grace period — UP transitions are suppressed for the first 500 ms.
  it('suppresses ghost reps during 500 ms post-cal grace period (round 22)', () => {
    // Within the grace window, simulate noisy knee Y that briefly crosses the
    // HIGH=25 threshold via noise on the leftKneeLiftPct signal. The engine
    // should NOT count a rep during the first 500 ms post-cal.
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) return { leftKneeLiftPct: 0, rightKneeLiftPct: 0 } as HighKneesPoseIntent;
        const tAfterCal = tMs - CAL_MS;
        if (tAfterCal < 500) {
          // Inject a 100% lift pulse at t=200ms — would normally trigger a rep.
          const left = (tAfterCal > 100 && tAfterCal < 350) ? 100 : 0;
          return { leftKneeLiftPct: left, rightKneeLiftPct: 0 } as HighKneesPoseIntent;
        }
        // After the grace window, no further motion — user just standing still.
        return { leftKneeLiftPct: 0, rightKneeLiftPct: 0 } as HighKneesPoseIntent;
      },
      buildHighKneesPose,
      { fps: 30, durationMs: CAL_MS + 2000 },
    );
    const result = runHighKneesSession(frames);
    expect(result.completedReps.length).toBe(0);
  });
});
