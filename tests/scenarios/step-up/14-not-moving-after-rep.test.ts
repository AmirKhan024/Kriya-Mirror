/**
 * Regression test for Fix O (EMA reseed) on Step-Up.
 *
 * After a real rep, the EMA-smoothed hip Y drifts back toward baseline over
 * several seconds. Without Fix O, the inflated min-max variance from this
 * drift permanently prevents the not-moving threshold from being crossed,
 * so 'not-moving' never fires even after 17+ seconds of idle.
 *
 * Fix (engine.ts): once smoothedHipY has settled (per-frame Δ < 0.002 for
 * 500ms), drop the cached min/max and reseed from the current value, so the
 * variance accumulator reflects only true post-settle jitter.
 *
 * Mirror of lunge's 14-not-moving-after-rep.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { StepUpEngine } from '@/modules/step-up/engine';
import type { StepUpRepEvent } from '@/modules/step-up/types';
import type { WarningType } from '@/store/workout';
import type { PoseLandmarks, NormalizedLandmark } from '@/modules/pose/types';

const IDX = {
  leftShoulder: 11, rightShoulder: 12,
  leftElbow: 13, rightElbow: 14,
  leftWrist: 15, rightWrist: 16,
  leftHip: 23, rightHip: 24,
  leftKnee: 25, rightKnee: 26,
  leftAnkle: 27, rightAnkle: 28,
  leftHeel: 29, rightHeel: 30,
  leftFootIndex: 31, rightFootIndex: 32,
  nose: 0, leftEye: 2, rightEye: 5, leftEar: 7, rightEar: 8,
};
const LM_COUNT = 33;

function makeLM(x: number, y: number, visibility = 0.95): NormalizedLandmark {
  return { x, y, z: 0, visibility };
}
function emptyPose(): PoseLandmarks {
  const out = new Array(LM_COUNT) as PoseLandmarks;
  for (let i = 0; i < LM_COUNT; i++) out[i] = makeLM(0.5, 0.5, 0);
  return out;
}

function buildStepUpPose(hipRise: number): PoseLandmarks {
  const pose = emptyPose();
  const cx = 0.50;
  const shoulderW = 0.10;
  const baseAnkleY = 0.92;
  const bodyHeight = 0.70;
  const shoulderY = baseAnkleY - bodyHeight;
  const hipBaseY = shoulderY + bodyHeight * 0.55;
  const hipY = hipBaseY - hipRise;
  const shoulderYNow = shoulderY - hipRise;
  // ankleXL/ankleXR: feet as wide as shoulders (feetWidthRatio=1.0)
  const ankleXL = cx - shoulderW;
  const ankleXR = cx + shoulderW;
  const hipXL = ankleXL;
  const hipXR = ankleXR;
  const kneeY = hipY + (baseAnkleY - hipY) * 0.5;
  const vis = 0.95;

  pose[IDX.leftShoulder] = makeLM(cx - shoulderW, shoulderYNow, vis);
  pose[IDX.rightShoulder] = makeLM(cx + shoulderW, shoulderYNow, vis);
  pose[IDX.leftElbow] = makeLM(cx - shoulderW - 0.05, shoulderYNow + 0.08, vis);
  pose[IDX.rightElbow] = makeLM(cx + shoulderW + 0.05, shoulderYNow + 0.08, vis);
  pose[IDX.leftWrist] = makeLM(cx - shoulderW - 0.05, shoulderYNow + 0.20, vis);
  pose[IDX.rightWrist] = makeLM(cx + shoulderW + 0.05, shoulderYNow + 0.20, vis);
  pose[IDX.leftHip] = makeLM(hipXL, hipY, vis);
  pose[IDX.rightHip] = makeLM(hipXR, hipY, vis);
  pose[IDX.leftKnee] = makeLM(hipXL - 0.01, kneeY, vis);
  pose[IDX.rightKnee] = makeLM(hipXR + 0.01, kneeY, vis);
  pose[IDX.leftAnkle] = makeLM(ankleXL, baseAnkleY, vis);
  pose[IDX.rightAnkle] = makeLM(ankleXR, baseAnkleY, vis);
  pose[IDX.leftHeel] = makeLM(ankleXL, baseAnkleY + 0.02, vis);
  pose[IDX.rightHeel] = makeLM(ankleXR, baseAnkleY + 0.02, vis);
  pose[IDX.leftFootIndex] = makeLM(ankleXL + 0.02, baseAnkleY + 0.03, vis);
  pose[IDX.rightFootIndex] = makeLM(ankleXR - 0.02, baseAnkleY + 0.03, vis);

  const noseY = shoulderYNow - 0.07;
  pose[IDX.nose] = makeLM(cx, noseY, vis);
  pose[IDX.leftEye] = makeLM(cx - 0.02, noseY - 0.01, vis);
  pose[IDX.rightEye] = makeLM(cx + 0.02, noseY - 0.01, vis);
  pose[IDX.leftEar] = makeLM(cx - 0.04, noseY, vis);
  pose[IDX.rightEar] = makeLM(cx + 0.04, noseY, vis);

  return pose;
}

function countWarnings(warnings: Array<{ type: WarningType }>, type: WarningType): number {
  return warnings.filter((w) => w.type === type).length;
}

const CAL_MS = 2200;

describe('Step-Up — regression: not-moving fires after a real rep + idle (Fix O)', () => {
  it('DOES fire not-moving when user rests in STANDING after completing a rep', () => {
    // Profile: stand still during calibration → one full step-up rep
    // (hipRise 0→0.15→0 over 4s) → 8s of STANDING idle.
    // Total = 2.2 + 4 + 8 = 14.2s.
    const REP_DURATION_MS = 4000;
    const REP_END_MS = CAL_MS + REP_DURATION_MS;
    const TOTAL_MS = REP_END_MS + 8000;

    const FPS = 30;
    const DT = 1000 / FPS;

    const warnings: Array<{ type: WarningType; atMs: number }> = [];
    let calibrated = false;
    let calibratedAtMs: number | null = null;
    let repCount = 0;
    let currentTMs = 0;

    const engine = new StepUpEngine({
      onCalibrationUpdate: (u) => {
        if (u.state === 'confirmed' && !calibrated) {
          calibrated = true;
          calibratedAtMs = currentTMs;
        }
      },
      onRepComplete: (_rep: StepUpRepEvent) => { repCount++; },
      onPostureWarning: (type) => { warnings.push({ type, atMs: currentTMs }); },
    });

    for (let t = 0; t < TOTAL_MS; t += DT) {
      currentTMs = t;
      let hipRise = 0;

      if (t >= CAL_MS && t < REP_END_MS) {
        const tInRep = t - CAL_MS;
        if (tInRep < 1000) {
          hipRise = (tInRep / 1000) * 0.15;        // 0→0.15 ascending
        } else if (tInRep < 2000) {
          hipRise = 0.15;                            // hold at top
        } else if (tInRep < 3500) {
          hipRise = 0.15 * (1 - (tInRep - 2000) / 1500); // 0.15→0 descending
        } else {
          hipRise = 0;                               // standing
        }
      }
      // t >= REP_END_MS: stand still (hipRise = 0)

      engine.update(buildStepUpPose(hipRise), t);
    }
    engine.finish();

    expect(calibrated).toBe(true);
    expect(calibratedAtMs).not.toBeNull();
    expect(calibratedAtMs!).toBeLessThan(500);

    // The whole point: idle warning must fire post-rep
    expect(countWarnings(warnings, 'not-moving')).toBeGreaterThanOrEqual(1);
  });
});
