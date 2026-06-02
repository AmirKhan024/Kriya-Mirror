/**
 * Burpee — happy path.
 * Verifies that 3 clean burpees are counted and that the state machine
 * cycles through STANDING → SQUATTING → PLANK → RISING → JUMPING → STANDING.
 *
 * Each burpee cycle (post-cal):
 *   0–300ms   : standing → squat transition (hipYOffset rises to 0.05)
 *   300–600ms : squat → plank  (hipYOffset rises to 0.16, knees extend)
 *   600–900ms : plank hold
 *   900–1100ms: rising (hipYOffset back to 0.02)
 *   1100–1400ms: jump (hipYOffset drops to -0.06)
 *   1400–1700ms: land (hipYOffset back to 0)
 *   1700–2000ms: rest standing
 *
 * Total rep cycle: ~2000ms (well above MIN_REP_DURATION_MS = 1200ms)
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildBurpeePose } from '../../harness/pose-stub';
import { runBurpeeSession, warningsOtherThan } from '../../harness/runner';
import type { BurpeePoseIntent } from '../../harness/types';

const CAL_MS = 500;   // burpee calibration is instant (200ms confirm)
const REP_MS = 2000;  // each rep takes 2s

function calibrationIntent(): BurpeePoseIntent {
  return { hipYOffset: 0, kneeAngleDeg: 170, bodyHeight: 0.62 };
}

function repIntentAt(tInRep: number): BurpeePoseIntent {
  if (tInRep < 300) {
    // Squatting down
    const frac = tInRep / 300;
    return { hipYOffset: frac * 0.05, kneeAngleDeg: 170 - frac * 80, bodyHeight: 0.62 };
  } else if (tInRep < 600) {
    // Moving to plank
    const frac = (tInRep - 300) / 300;
    return { hipYOffset: 0.05 + frac * 0.11, kneeAngleDeg: 90 + frac * 80, bodyHeight: 0.62 };
  } else if (tInRep < 900) {
    // Plank hold
    return { hipYOffset: 0.16, kneeAngleDeg: 170, bodyHeight: 0.62 };
  } else if (tInRep < 1100) {
    // Rising back up
    const frac = (tInRep - 900) / 200;
    return { hipYOffset: 0.16 - frac * 0.14, kneeAngleDeg: 170, bodyHeight: 0.62 };
  } else if (tInRep < 1400) {
    // Jump
    const frac = (tInRep - 1100) / 300;
    const jumpCurve = Math.sin(frac * Math.PI); // rises then falls
    return { hipYOffset: -0.06 * jumpCurve, kneeAngleDeg: 170, bodyHeight: 0.62 };
  } else {
    // Standing rest
    return { hipYOffset: 0, kneeAngleDeg: 170, bodyHeight: 0.62 };
  }
}

describe('Burpee — happy path', () => {
  it('calibrates instantly and counts 3 clean burpees', () => {
    const totalMs = CAL_MS + 3 * REP_MS;

    const frames = buildFrames(
      (tMs): BurpeePoseIntent => {
        if (tMs < CAL_MS) return calibrationIntent();
        const tInRep = (tMs - CAL_MS) % REP_MS;
        return repIntentAt(tInRep);
      },
      buildBurpeePose,
      { fps: 30, durationMs: totalMs },
    );

    const result = runBurpeeSession(frames);

    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).not.toBeNull();
    expect(result.calibrationConfirmedAtMs!).toBeLessThan(CAL_MS + 500);
    expect(result.completedReps.length).toBe(3);

    // No unexpected warnings (not-moving is OK during calibration)
    const unexpected = warningsOtherThan(result, 'not-moving');
    expect(unexpected.length).toBe(0);

    // Each rep should have a reasonable MQS
    for (const rep of result.completedReps) {
      expect(rep.mqs).toBeGreaterThan(0);
      expect(rep.mqs).toBeLessThanOrEqual(100);
    }
  });

  it('counts 1 burpee when given a single rep stream', () => {
    const totalMs = CAL_MS + 1 * REP_MS;

    const frames = buildFrames(
      (tMs): BurpeePoseIntent => {
        if (tMs < CAL_MS) return calibrationIntent();
        const tInRep = (tMs - CAL_MS) % REP_MS;
        return repIntentAt(tInRep);
      },
      buildBurpeePose,
      { fps: 30, durationMs: totalMs },
    );

    const result = runBurpeeSession(frames);
    expect(result.completedReps.length).toBe(1);
  });
});
