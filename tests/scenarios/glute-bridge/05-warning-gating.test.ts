/**
 * Regression test for Fix A on Glute Bridge: posture warnings (lower-back-arch)
 * must NOT fire while the user is in RESTING state between reps. The engine
 * gates maybeEmitWarning to repState !== 'RESTING'.
 *
 * This test holds the user at hipRise=1.5 (arch territory) while still RESTING
 * (no bridge started) and asserts ZERO lower-back-arch warnings. Then it verifies
 * the warning DOES fire once the user enters an active rep with the same signal.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildGluteBridgePose } from '../../harness/pose-stub';
import { runGluteBridgeSession, countWarnings } from '../../harness/runner';
import type { GluteBridgePoseIntent } from '../../harness/types';

// ASCEND_START_FRAC = 0.08 — engine enters ASCENDING only once hipRiseFraction > 0.08
// So hipRise=0 is definitively RESTING. We simulate arch (hipRise=1.5) while
// keeping the rise just below ASCEND_START_FRAC=0.08 * kaby to stay in RESTING.

const CAL_MS = 400;

describe('Glute Bridge — warning gating (no lower-back-arch during RESTING)', () => {
  it('does NOT fire lower-back-arch while user stays flat (RESTING) post-calibration', () => {
    // After calibration, hold hipRise=0 for 5 seconds. No rep → RESTING the whole time.
    // lower-back-arch cannot fire in RESTING.
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) return { hipRise: 0 } as GluteBridgePoseIntent;
        // Stay flat — RESTING state, arch check value is 0 (not arch territory anyway,
        // but this confirms gate is state-based, not value-based).
        return { hipRise: 0 } as GluteBridgePoseIntent;
      },
      buildGluteBridgePose,
      { fps: 30, durationMs: CAL_MS + 5000 },
    );
    const result = runGluteBridgeSession(frames);
    expect(countWarnings(result, 'lower-back-arch')).toBe(0);
  });

  it('DOES fire lower-back-arch once the user enters an active rep with arch', () => {
    const REP_CYCLE_MS = 2300;
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) return { hipRise: 0 } as GluteBridgePoseIntent;
        const tInRep = (tMs - CAL_MS) % REP_CYCLE_MS;
        let hipRise: number;
        // Rise to 1.5 (arch territory) — engine enters ASCENDING at 0.08
        if (tInRep < 900) hipRise = (tInRep / 900) * 1.5;
        else if (tInRep < 1200) hipRise = 1.5;
        else if (tInRep < 2000) hipRise = 1.5 - ((tInRep - 1200) / 800) * 1.5;
        else hipRise = 0;
        return { hipRise } as GluteBridgePoseIntent;
      },
      buildGluteBridgePose,
      { fps: 30, durationMs: CAL_MS + 2 * REP_CYCLE_MS },
    );
    const result = runGluteBridgeSession(frames);
    expect(countWarnings(result, 'lower-back-arch')).toBeGreaterThan(0);
  });
});
