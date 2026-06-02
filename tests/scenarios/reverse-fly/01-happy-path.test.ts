/**
 * Reverse Fly — happy path.
 * 3 clean full fly reps count correctly. States cycle DOWN → RAISING → AT_TOP → LOWERING → DOWN.
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildReverseFlyPose } from '../../harness/pose-stub';
import { runReverseFlySession, warningsOtherThan } from '../../harness/runner';

// Profile: 300ms calibration (bentOver, arms hanging), then N reps.
// Each rep cycle: 1000ms raise (0→70°), 500ms hold at top, 1000ms lower (70→0°), 500ms rest.
const CAL_MS = 300;
const REP_CYCLE_MS = 3000;

function happyPathIntent(reps: number) {
  const totalMs = CAL_MS + reps * REP_CYCLE_MS + 500;
  const intentAt = (tMs: number) => {
    if (tMs < CAL_MS) {
      // Calibration: bent over, arms hanging (armLiftDeg = 0)
      return { armLiftDeg: 0, bentOver: true };
    }
    const tInRep = (tMs - CAL_MS) % REP_CYCLE_MS;
    let liftDeg: number;
    if (tInRep < 1000)      liftDeg = (tInRep / 1000) * 70;
    else if (tInRep < 1500) liftDeg = 70;
    else if (tInRep < 2500) liftDeg = 70 - ((tInRep - 1500) / 1000) * 70;
    else                    liftDeg = 0;
    return { armLiftDeg: liftDeg, bentOver: true };
  };
  return { totalMs, intentAt };
}

describe('Reverse Fly — happy path', () => {
  it('calibrates and counts 3 clean reps with no form warnings', () => {
    const { totalMs, intentAt } = happyPathIntent(3);
    const frames = buildFrames(intentAt, buildReverseFlyPose, { fps: 30, durationMs: totalMs });
    const result = runReverseFlySession(frames);

    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.completedReps.length).toBe(3);
    expect(warningsOtherThan(result, 'not-moving').length).toBe(0);
  });

  it('counts 1 rep when given a 1-rep stream', () => {
    const { totalMs, intentAt } = happyPathIntent(1);
    const frames = buildFrames(intentAt, buildReverseFlyPose, { fps: 30, durationMs: totalMs });
    const result = runReverseFlySession(frames);

    expect(result.completedReps.length).toBe(1);
  });

  it('all completed reps have positive MQS', () => {
    const { totalMs, intentAt } = happyPathIntent(3);
    const frames = buildFrames(intentAt, buildReverseFlyPose, { fps: 30, durationMs: totalMs });
    const result = runReverseFlySession(frames);

    expect(result.completedReps.length).toBeGreaterThan(0);
    for (const rep of result.completedReps) {
      expect(rep.mqs).toBeGreaterThan(0);
    }
  });

  it('frame metrics report repState transitions', () => {
    const { totalMs, intentAt } = happyPathIntent(2);
    const frames = buildFrames(intentAt, buildReverseFlyPose, { fps: 30, durationMs: totalMs });
    const result = runReverseFlySession(frames);

    const states = result.frameMetricsSamples.map((m) => m.repState);
    expect(states).toContain('DOWN');
    expect(states).toContain('RAISING');
    expect(states).toContain('AT_TOP');
    expect(states).toContain('LOWERING');
  });

  it('reps have depthDeg close to the fly peak angle', () => {
    const { totalMs, intentAt } = happyPathIntent(2);
    const frames = buildFrames(intentAt, buildReverseFlyPose, { fps: 30, durationMs: totalMs });
    const result = runReverseFlySession(frames);

    expect(result.completedReps.length).toBeGreaterThan(0);
    for (const rep of result.completedReps) {
      // Peak should be in the vicinity of 70° (our target)
      expect(rep.depthDeg).toBeGreaterThan(50);
    }
  });
});
