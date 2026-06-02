import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildGluteBridgePose } from '../../harness/pose-stub';
import { runGluteBridgeSession, warningsOtherThan } from '../../harness/runner';
import type { GluteBridgePoseIntent } from '../../harness/types';

// Calibration: lie still ~400ms (CONFIRM_DURATION_MS=200, instant-confirm)
// Each rep cycle:
//   0–900ms  : rise 0→1 (full extension)
//   900–1200ms : hold at top
//   1200–2000ms : descend 1→0
//   2000–2300ms : rest at bottom
const CAL_MS = 400;
const REP_CYCLE_MS = 2300;

function happyPathFrames(reps: number) {
  const totalMs = CAL_MS + reps * REP_CYCLE_MS + 500;
  return buildFrames(
    (tMs) => {
      if (tMs < CAL_MS) {
        return { hipRise: 0 } as GluteBridgePoseIntent;
      }
      const tInRep = (tMs - CAL_MS) % REP_CYCLE_MS;
      let hipRise: number;
      if (tInRep < 900) hipRise = (tInRep / 900);
      else if (tInRep < 1200) hipRise = 1.0;
      else if (tInRep < 2000) hipRise = 1.0 - ((tInRep - 1200) / 800);
      else hipRise = 0;
      return { hipRise } as GluteBridgePoseIntent;
    },
    buildGluteBridgePose,
    { fps: 30, durationMs: totalMs },
  );
}

describe('Glute Bridge — happy path', () => {
  it('calibrates within 400ms and counts 3 clean reps', () => {
    const frames = happyPathFrames(3);
    const result = runGluteBridgeSession(frames);

    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThanOrEqual(500);
    expect(result.completedReps.length).toBe(3);
    expect(warningsOtherThan(result, 'not-moving').length).toBe(0);
  });

  it('counts 5 reps when given a 5-rep stream', () => {
    const frames = happyPathFrames(5);
    const result = runGluteBridgeSession(frames);
    expect(result.completedReps.length).toBe(5);
  });

  it('clean reps produce avg MQS >= 50', () => {
    const frames = happyPathFrames(4);
    const result = runGluteBridgeSession(frames);
    expect(result.completedReps.length).toBeGreaterThanOrEqual(3);
    const avgMqs = result.completedReps.reduce((s, r) => s + r.mqs, 0) / result.completedReps.length;
    expect(avgMqs).toBeGreaterThanOrEqual(50);
  });
});
