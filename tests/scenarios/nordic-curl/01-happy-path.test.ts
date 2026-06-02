/**
 * Nordic Curl — happy path
 *
 * Scenario: 2.5s calibration (kneeling upright, side-facing), then 4 reps.
 * Each rep: lean 0° → 55° over 1500ms, hold 500ms, return over 1500ms, rest 800ms.
 * Assert: calibrationConfirmedAtMs ≤ 2600, completedReps.length === 4, avgMqs ≥ 50.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildNordicCurlPose } from '../../harness/pose-stub';
import { runNordicCurlSession, warningsOtherThan } from '../../harness/runner';
import type { NordicCurlPoseIntent } from '../../harness/types';

const CAL_MS = 2500;
const REP_DESCENT_MS = 1500;
const REP_HOLD_MS = 500;
const REP_ASCENT_MS = 1500;
const REP_REST_MS = 800;
const REP_CYCLE_MS = REP_DESCENT_MS + REP_HOLD_MS + REP_ASCENT_MS + REP_REST_MS;
const PEAK_LEAN_DEG = 55;

function happyPathIntent(reps: number) {
  const totalMs = CAL_MS + reps * REP_CYCLE_MS;
  return {
    totalMs,
    intentAt: (tMs: number): NordicCurlPoseIntent => {
      if (tMs < CAL_MS) {
        // Calibration: kneeling upright, trunk lean ~0°
        return { trunkLeanDeg: 0, bodyHeight: 0.60 };
      }
      const tInSession = tMs - CAL_MS;
      const tInRep = tInSession % REP_CYCLE_MS;

      let lean: number;
      if (tInRep < REP_DESCENT_MS) {
        // Descend: 0° → 55°
        lean = (tInRep / REP_DESCENT_MS) * PEAK_LEAN_DEG;
      } else if (tInRep < REP_DESCENT_MS + REP_HOLD_MS) {
        // Hold at bottom
        lean = PEAK_LEAN_DEG;
      } else if (tInRep < REP_DESCENT_MS + REP_HOLD_MS + REP_ASCENT_MS) {
        // Ascend: 55° → 0°
        const t = tInRep - REP_DESCENT_MS - REP_HOLD_MS;
        lean = PEAK_LEAN_DEG - (t / REP_ASCENT_MS) * PEAK_LEAN_DEG;
      } else {
        // Rest in TALL position
        lean = 0;
      }

      return { trunkLeanDeg: lean, bodyHeight: 0.60 };
    },
  };
}

describe('Nordic Curl — happy path', () => {
  it('calibrates within 2.6s and counts 4 reps with decent MQS', () => {
    const { totalMs, intentAt } = happyPathIntent(4);
    const frames = buildFrames(intentAt, buildNordicCurlPose as (i: NordicCurlPoseIntent) => import('@/modules/pose/types').PoseLandmarks, {
      fps: 30,
      durationMs: totalMs,
    });

    const result = runNordicCurlSession(frames);

    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).not.toBeNull();
    expect(result.calibrationConfirmedAtMs!).toBeLessThanOrEqual(2600);
    expect(result.completedReps.length).toBe(4);
    expect(warningsOtherThan(result, 'not-moving').length).toBe(0);

    const avgMqs = result.completedReps.reduce((s, r) => s + r.mqs, 0) / result.completedReps.length;
    expect(avgMqs).toBeGreaterThanOrEqual(50);
  });

  it('counts 2 reps when given a 2-rep stream', () => {
    const { totalMs, intentAt } = happyPathIntent(2);
    const frames = buildFrames(intentAt, buildNordicCurlPose as (i: NordicCurlPoseIntent) => import('@/modules/pose/types').PoseLandmarks, {
      fps: 30,
      durationMs: totalMs,
    });
    const result = runNordicCurlSession(frames);
    expect(result.completedReps.length).toBe(2);
  });
});
