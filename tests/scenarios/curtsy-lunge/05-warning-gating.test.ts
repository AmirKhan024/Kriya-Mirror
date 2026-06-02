/**
 * Fix A regression: posture warnings must NOT fire while repState is STANDING
 * (resting between reps). They should only fire during DESCENDING/AT_BOTTOM/ASCENDING.
 *
 * Test: simulate posture faults while user is standing still (STANDING state).
 * → zero posture warnings should fire.
 *
 * Then simulate the same faults during an active rep.
 * → warnings should fire.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildCurtsyLungePose } from '../../harness/pose-stub';
import { runCurtsyLungeSession, countWarnings, warningsOtherThan } from '../../harness/runner';
import type { CurtsyLungePoseIntent } from '../../harness/types';

const CAL_MS = 2200;

describe('Curtsy Lunge — warning gating (Fix A)', () => {
  it('does NOT emit posture warnings while user is standing (STANDING state)', () => {
    // After calibration, user stands still with trunk-lean + knee-valgus injected
    // but never starts a rep (knee angle stays above DESCENT_START_DEG = 155°)
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) {
          return { kneeFlexionDeg: 170, crossoverRatio: 0 } as CurtsyLungePoseIntent;
        }
        // STANDING state: knee angle stays at 165° (above 155° threshold)
        // Inject trunk-lean and knee-valgus — should NOT trigger warnings in STANDING
        return {
          kneeFlexionDeg: 165,
          crossoverRatio: 0,
          trunkLeanDeg: 50,      // > 45° — but should be gated in STANDING
          kneeValgusRatio: 0.25, // > 0.18 — but should be gated in STANDING
        } as CurtsyLungePoseIntent;
      },
      buildCurtsyLungePose,
      { fps: 30, durationMs: CAL_MS + 3000 },
    );

    const result = runCurtsyLungeSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    // Fix A: posture warnings gated — none should fire while STANDING
    expect(countWarnings(result, 'trunk-lean' as any)).toBe(0);
    expect(countWarnings(result, 'knee-valgus' as any)).toBe(0);
    expect(countWarnings(result, 'hip-rotation-curtsy' as any)).toBe(0);
  });

  it('DOES emit posture warnings during DESCENDING/AT_BOTTOM phase', () => {
    const REP_CYCLE_MS = 3500;
    const frames = buildFrames(
      (tMs) => {
        if (tMs < CAL_MS) {
          return { kneeFlexionDeg: 170, crossoverRatio: 0 } as CurtsyLungePoseIntent;
        }
        const tInRep = tMs - CAL_MS;
        let kneeFlexionDeg: number;
        if (tInRep < 1200) kneeFlexionDeg = 170 - (tInRep / 1200) * 80;
        else if (tInRep < 1700) kneeFlexionDeg = 90;
        else if (tInRep < 2900) kneeFlexionDeg = 90 + ((tInRep - 1700) / 1200) * 80;
        else kneeFlexionDeg = 170;
        const inRep = tInRep < 2900;
        return {
          kneeFlexionDeg,
          crossoverRatio: inRep ? 0.12 : 0,
          trunkLeanDeg: inRep ? 50 : 0,       // lean only during rep
          kneeValgusRatio: inRep ? 0.25 : 0,  // valgus only during rep
        } as CurtsyLungePoseIntent;
      },
      buildCurtsyLungePose,
      { fps: 30, durationMs: CAL_MS + REP_CYCLE_MS },
    );

    const result = runCurtsyLungeSession(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    // Warnings should fire during the active rep phase
    const trunkWarnings = countWarnings(result, 'trunk-lean' as any);
    const valgusWarnings = countWarnings(result, 'knee-valgus' as any);
    expect(trunkWarnings + valgusWarnings).toBeGreaterThan(0);
  });
});
