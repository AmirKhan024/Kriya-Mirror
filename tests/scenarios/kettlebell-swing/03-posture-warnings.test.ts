/**
 * Kettlebell Swing — posture warnings.
 * Tests Fix A: squat-pattern fires when knee bends excessively during active rep.
 * Tests Fix A: arm-lift fires when wrist above shoulder during active rep.
 * Tests P1-2: rounded-back fires when shoulder drops below hip during active rep.
 * All gated to active rep (not STANDING).
 */
import { describe, it, expect } from 'vitest';
import { buildFrames } from '../../harness/frame-stream';
import { buildKBSwingPose } from '../../harness/pose-stub';
import { runKBSwingSession, countWarnings } from '../../harness/runner';
import type { KBSwingPoseIntent } from '../../harness/types';

const CAL_MS = 1000;
const REP_CYCLE_MS = 3000;

function repWithSquatPattern(tMs: number): KBSwingPoseIntent {
  if (tMs < CAL_MS) return { hipHingeDeg: 0, extraKneeBend: 0 };
  const tInRep = (tMs - CAL_MS) % REP_CYCLE_MS;
  let hinge: number;
  let extraKneeBend = 0;
  if (tInRep < 800) {
    hinge = 0;
  } else if (tInRep < 1600) {
    hinge = ((tInRep - 800) / 800) * 65;
    extraKneeBend = 30;  // 30° excess knee bend — above the 25° threshold
  } else if (tInRep < 1900) {
    hinge = 65;
    extraKneeBend = 30;
  } else if (tInRep < 2700) {
    hinge = 65 - ((tInRep - 1900) / 800) * 65;
    extraKneeBend = 15;
  } else {
    hinge = 0;
  }
  return { hipHingeDeg: hinge, extraKneeBend };
}

function repWithArmLift(tMs: number): KBSwingPoseIntent {
  if (tMs < CAL_MS) return { hipHingeDeg: 0, armLift: false };
  const tInRep = (tMs - CAL_MS) % REP_CYCLE_MS;
  let hinge: number;
  let armLift = false;
  if (tInRep < 800) {
    hinge = 0;
  } else if (tInRep < 1600) {
    hinge = ((tInRep - 800) / 800) * 65;
  } else if (tInRep < 1900) {
    hinge = 65;
  } else if (tInRep < 2700) {
    hinge = 65 - ((tInRep - 1900) / 800) * 65;
    armLift = true;  // arms lifted during snap phase
  } else {
    hinge = 0;
  }
  return { hipHingeDeg: hinge, armLift };
}

function repWithRoundedBack(tMs: number): KBSwingPoseIntent {
  if (tMs < CAL_MS) return { hipHingeDeg: 0, roundedBack: false };
  const tInRep = (tMs - CAL_MS) % REP_CYCLE_MS;
  let hinge: number;
  let roundedBack = false;
  if (tInRep < 800) {
    hinge = 0;
  } else if (tInRep < 1600) {
    hinge = ((tInRep - 800) / 800) * 65;
    roundedBack = true; // shoulder drops below hip during hike-back (gross rounding)
  } else if (tInRep < 1900) {
    hinge = 65;
    roundedBack = true;
  } else if (tInRep < 2700) {
    hinge = 65 - ((tInRep - 1900) / 800) * 65;
  } else {
    hinge = 0;
  }
  return { hipHingeDeg: hinge, roundedBack };
}

describe('Kettlebell Swing — posture warnings', () => {
  it('fires squat-pattern when knee bends > 25° above calibration baseline during active rep', () => {
    const TOTAL_MS = CAL_MS + 3 * REP_CYCLE_MS;
    const frames = buildFrames(repWithSquatPattern, buildKBSwingPose, { fps: 30, durationMs: TOTAL_MS });
    const result = runKBSwingSession(frames);

    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'squat-pattern')).toBeGreaterThanOrEqual(1);
  });

  it('fires arm-lift when wrist rises above shoulder during active rep', () => {
    const TOTAL_MS = CAL_MS + 3 * REP_CYCLE_MS;
    const frames = buildFrames(repWithArmLift, buildKBSwingPose, { fps: 30, durationMs: TOTAL_MS });
    const result = runKBSwingSession(frames);

    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'arm-lift')).toBeGreaterThanOrEqual(1);
  });

  it('fires rounded-back when shoulder drops below hip during active rep (P1-2)', () => {
    // roundedBack: true drops the shoulder 0.06 below hip, making torsoAngleDeg > 90° > threshold(88°)
    const TOTAL_MS = CAL_MS + 3 * REP_CYCLE_MS;
    const frames = buildFrames(repWithRoundedBack, buildKBSwingPose, { fps: 30, durationMs: TOTAL_MS });
    const result = runKBSwingSession(frames);

    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'rounded-back')).toBeGreaterThanOrEqual(1);
  });
});
