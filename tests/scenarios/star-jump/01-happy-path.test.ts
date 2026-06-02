/**
 * Star Jump — happy path.
 * 5 clean full jumps count correctly. States cycle DOWN → RAISING → AT_TOP → LOWERING → DOWN.
 *
 * Geometry reminder (SJ_ARM_L_TOTAL=0.26, front-camera):
 *   wristDelta = shoulderY - wristMidY
 *   armRaiseDeg=0   → wristDelta ≈ -0.26 (arms at sides, well below DOWN_THRESHOLD=-0.06)
 *   armRaiseDeg=90  → wristDelta ≈  0.00 (T-pose, shoulder height)
 *   armRaiseDeg=130 → wristDelta ≈ +0.167 (past AT_TOP_THRESHOLD=0.08)
 *   armRaiseDeg=170 → wristDelta ≈ +0.256 (nearly overhead)
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildStarJumpPose } from '../../harness/pose-stub';
import { runStarJumpSession, warningsOtherThan } from '../../harness/runner';

const CAL_MS = 300;
// Each rep: 800ms raise (0→170°), 400ms hold at top, 800ms lower (170→0°), 500ms rest.
const REP_CYCLE_MS = 2500;

function happyPathIntent(reps: number) {
  const totalMs = CAL_MS + reps * REP_CYCLE_MS + 500;
  const intentAt = (tMs: number) => {
    if (tMs < CAL_MS) return { armRaiseDeg: 0, feetSpreadRatio: 1.0 };
    const tInRep = (tMs - CAL_MS) % REP_CYCLE_MS;
    let armRaiseDeg: number;
    let feetSpreadRatio: number;
    if (tInRep < 800) {
      armRaiseDeg = (tInRep / 800) * 170;
      feetSpreadRatio = 1.0 + (tInRep / 800) * 0.5;
    } else if (tInRep < 1200) {
      armRaiseDeg = 170;
      feetSpreadRatio = 1.5;
    } else if (tInRep < 2000) {
      armRaiseDeg = 170 - ((tInRep - 1200) / 800) * 170;
      feetSpreadRatio = 1.5 - ((tInRep - 1200) / 800) * 0.5;
    } else {
      armRaiseDeg = 0;
      feetSpreadRatio = 1.0;
    }
    return { armRaiseDeg, feetSpreadRatio };
  };
  return { totalMs, intentAt };
}

describe('Star Jump — happy path', () => {
  it('calibrates and counts 5 clean reps with no form warnings', () => {
    const { totalMs, intentAt } = happyPathIntent(5);
    const frames = buildFrames(intentAt, buildStarJumpPose, { fps: 30, durationMs: totalMs });
    const result = runStarJumpSession(frames);

    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.completedReps.length).toBe(5);
    expect(warningsOtherThan(result, 'not-moving').length).toBe(0);
  });

  it('counts 3 reps when given a 3-rep stream', () => {
    const { totalMs, intentAt } = happyPathIntent(3);
    const frames = buildFrames(intentAt, buildStarJumpPose, { fps: 30, durationMs: totalMs });
    const result = runStarJumpSession(frames);

    expect(result.completedReps.length).toBe(3);
  });

  it('all completed reps have positive MQS', () => {
    const { totalMs, intentAt } = happyPathIntent(3);
    const frames = buildFrames(intentAt, buildStarJumpPose, { fps: 30, durationMs: totalMs });
    const result = runStarJumpSession(frames);

    expect(result.completedReps.length).toBeGreaterThan(0);
    for (const rep of result.completedReps) {
      expect(rep.mqs).toBeGreaterThan(0);
    }
  });

  it('frame metrics report all four repState transitions', () => {
    const { totalMs, intentAt } = happyPathIntent(2);
    const frames = buildFrames(intentAt, buildStarJumpPose, { fps: 30, durationMs: totalMs });
    const result = runStarJumpSession(frames);

    const states = result.frameMetricsSamples.map((m) => m.repState);
    expect(states).toContain('DOWN');
    expect(states).toContain('RAISING');
    expect(states).toContain('AT_TOP');
    expect(states).toContain('LOWERING');
  });
});
