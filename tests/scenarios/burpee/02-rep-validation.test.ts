/**
 * Burpee — rep validation.
 * Tests the validateRepShape() path (Fix B + Fix D):
 *   - incomplete-plank: user never reaches PLANK_ENTER (0.14) threshold
 *   - no-jump: user reaches plank but never jumps (JUMPING state never entered)
 *   - (malformed-rep for glitches is indirectly covered by Fix D's ballistic check)
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildBurpeePose } from '../../harness/pose-stub';
import { runBurpeeSession, countWarnings } from '../../harness/runner';
import type { BurpeePoseIntent } from '../../harness/types';

const CAL_MS = 500;

function calibrationIntent(): BurpeePoseIntent {
  return { hipYOffset: 0, kneeAngleDeg: 170, bodyHeight: 0.62 };
}

describe('Burpee — rep validation', () => {
  it('emits incomplete-plank when hip never drops to PLANK_ENTER threshold', () => {
    // User only does a shallow squat (hipYOffset peaks at ~0.06, below 0.14)
    // then returns to standing and jumps. PLANK state never entered → incomplete-plank.
    const REP_MS = 2000;
    const totalMs = CAL_MS + REP_MS;

    const frames = buildFrames(
      (tMs): BurpeePoseIntent => {
        if (tMs < CAL_MS) return calibrationIntent();
        const tInRep = tMs - CAL_MS;
        if (tInRep < 500) {
          // Shallow squat only (never reaches PLANK_ENTER=0.14)
          const frac = tInRep / 500;
          return { hipYOffset: frac * 0.08, kneeAngleDeg: 110, bodyHeight: 0.62 };
        } else if (tInRep < 800) {
          // Return up
          const frac = (tInRep - 500) / 300;
          return { hipYOffset: 0.08 - frac * 0.08, kneeAngleDeg: 170, bodyHeight: 0.62 };
        } else if (tInRep < 1100) {
          // Jump
          const frac = (tInRep - 800) / 300;
          return { hipYOffset: -0.06 * Math.sin(frac * Math.PI), kneeAngleDeg: 170, bodyHeight: 0.62 };
        } else {
          return { hipYOffset: 0, kneeAngleDeg: 170, bodyHeight: 0.62 };
        }
      },
      buildBurpeePose,
      { fps: 30, durationMs: totalMs },
    );

    const result = runBurpeeSession(frames);

    expect(result.finalCalibration?.state).toBe('confirmed');
    // Rep should NOT be counted
    expect(result.completedReps.length).toBe(0);
    // incomplete-plank should fire
    expect(countWarnings(result, 'incomplete-plank')).toBeGreaterThan(0);
    // no-jump should NOT fire (since incomplete-plank fires first)
    expect(countWarnings(result, 'no-jump')).toBe(0);
  });

  it('emits no-jump when user reaches plank but skips the jump', () => {
    // User does squat + plank + rises back to standing but never jumps.
    // JUMPING state never entered → no-jump warning on return to STANDING.
    const REP_MS = 2500;
    const totalMs = CAL_MS + REP_MS;

    const frames = buildFrames(
      (tMs): BurpeePoseIntent => {
        if (tMs < CAL_MS) return calibrationIntent();
        const tInRep = tMs - CAL_MS;
        if (tInRep < 300) {
          // Squat down
          const frac = tInRep / 300;
          return { hipYOffset: frac * 0.05, kneeAngleDeg: 170 - frac * 80, bodyHeight: 0.62 };
        } else if (tInRep < 600) {
          // To plank
          const frac = (tInRep - 300) / 300;
          return { hipYOffset: 0.05 + frac * 0.12, kneeAngleDeg: 90 + frac * 80, bodyHeight: 0.62 };
        } else if (tInRep < 900) {
          // Plank hold
          return { hipYOffset: 0.17, kneeAngleDeg: 170, bodyHeight: 0.62 };
        } else if (tInRep < 1500) {
          // Rise back up — but only to STANDING, no jump
          const frac = (tInRep - 900) / 600;
          return { hipYOffset: 0.17 - frac * 0.17, kneeAngleDeg: 170, bodyHeight: 0.62 };
        } else {
          // Standing — never jumps
          return { hipYOffset: 0, kneeAngleDeg: 170, bodyHeight: 0.62 };
        }
      },
      buildBurpeePose,
      { fps: 30, durationMs: totalMs },
    );

    const result = runBurpeeSession(frames);

    expect(result.finalCalibration?.state).toBe('confirmed');
    // Rep should NOT be counted
    expect(result.completedReps.length).toBe(0);
    // no-jump warning should fire
    expect(countWarnings(result, 'no-jump')).toBeGreaterThan(0);
    // incomplete-plank should NOT fire (plank was reached)
    expect(countWarnings(result, 'incomplete-plank')).toBe(0);
  });
});
