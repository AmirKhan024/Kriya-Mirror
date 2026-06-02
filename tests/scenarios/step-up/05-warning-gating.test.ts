/**
 * Step-Up — Fix A warning gating.
 *
 * Spec: valgus and trunk-forward are gated to repState !== 'STANDING'.
 * These warnings MUST NOT fire while the user is standing still at the baseline.
 * They MUST fire once the user is in ASCENDING state.
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

function buildPose(hipRise: number, valgusRatio = 0, trunkLeanDeg = 0): PoseLandmarks {
  const pose = emptyPose();
  const cx = 0.50;
  const shoulderW = 0.10;
  const baseAnkleY = 0.92;
  const bodyHeight = 0.70;
  const shoulderY = baseAnkleY - bodyHeight;
  const hipBaseY = shoulderY + bodyHeight * 0.55;
  const hipY = hipBaseY - hipRise;

  const trunkLeanRad = (trunkLeanDeg * Math.PI) / 180;
  // To produce trunkLeanDeg from atan2(|dx|, dy), need dx = tan(angle) * dy
  const torsoHeight = hipBaseY - shoulderY;
  const trunkShiftX = Math.tan(trunkLeanRad) * torsoHeight;
  const shoulderYNow = shoulderY - hipRise;

  // ankleXL/ankleXR: feet as wide as shoulders (feetWidthRatio=1.0)
  const ankleXL = cx - shoulderW;
  const ankleXR = cx + shoulderW;
  const hipXL = ankleXL;
  const hipXR = ankleXR;
  const baselineKneeOffset = shoulderW;
  const lkX = hipXL + baselineKneeOffset * valgusRatio;
  const rkX = hipXR - baselineKneeOffset * valgusRatio;
  const kneeY = hipY + (baseAnkleY - hipY) * 0.5;
  const vis = 0.95;

  pose[IDX.leftShoulder] = makeLM(cx - shoulderW + trunkShiftX, shoulderYNow, vis);
  pose[IDX.rightShoulder] = makeLM(cx + shoulderW + trunkShiftX, shoulderYNow, vis);
  pose[IDX.leftElbow] = makeLM(cx - shoulderW - 0.05, shoulderYNow + 0.08, vis);
  pose[IDX.rightElbow] = makeLM(cx + shoulderW + 0.05, shoulderYNow + 0.08, vis);
  pose[IDX.leftWrist] = makeLM(cx - shoulderW - 0.05, shoulderYNow + 0.20, vis);
  pose[IDX.rightWrist] = makeLM(cx + shoulderW + 0.05, shoulderYNow + 0.20, vis);
  pose[IDX.leftHip] = makeLM(hipXL, hipY, vis);
  pose[IDX.rightHip] = makeLM(hipXR, hipY, vis);
  pose[IDX.leftKnee] = makeLM(lkX, kneeY, vis);
  pose[IDX.rightKnee] = makeLM(rkX, kneeY, vis);
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

describe('Step-Up — Fix A warning gating', () => {
  it('valgus does NOT fire during STANDING phase (hip never leaves baseline)', () => {
    // Feed 4 seconds of standing with constant valgus — engine should be calibrated
    // but since hipRise is always 0, repState stays STANDING → no valgus warning
    const FPS = 30;
    const DT = 1000 / FPS;
    const TOTAL_MS = 4000;
    const VALGUS_RATIO = 0.60;  // well above 0.20 threshold (kneeDeviation=0.5*0.6=0.30)

    const warnings: Array<{ type: WarningType; atMs: number }> = [];
    let calibrated = false;

    const engine = new StepUpEngine({
      onCalibrationUpdate: (u) => { if (u.state === 'confirmed') calibrated = true; },
      onRepComplete: (_rep: StepUpRepEvent) => { /* noop */ },
      onPostureWarning: (type) => { warnings.push({ type, atMs: 0 }); },
    });

    for (let t = 0; t < TOTAL_MS; t += DT) {
      engine.update(buildPose(0, VALGUS_RATIO), t);
    }
    engine.finish();

    expect(calibrated).toBe(true);
    const valgusWarnings = warnings.filter((w) => w.type === 'valgus');
    expect(valgusWarnings.length).toBe(0);
  });

  it('valgus DOES fire when same valgus is present during ASCENDING state', () => {
    // Cal for 2.2s, then step up with strong valgus
    // Need valgusRatio > 0.40 so kneeDeviation = 0.5*ratio > 0.20
    const FPS = 30;
    const DT = 1000 / FPS;
    const CAL_MS = 2200;
    const VALGUS_RATIO = 0.60;
    const TOTAL_MS = CAL_MS + 4000;

    const warnings: Array<{ type: WarningType; atMs: number }> = [];
    let calibrated = false;
    let currentTMs = 0;

    const engine = new StepUpEngine({
      onCalibrationUpdate: (u) => { if (u.state === 'confirmed') calibrated = true; },
      onRepComplete: (_rep: StepUpRepEvent) => { /* noop */ },
      onPostureWarning: (type) => { warnings.push({ type, atMs: currentTMs }); },
    });

    for (let t = 0; t < TOTAL_MS; t += DT) {
      currentTMs = t;
      const tAfterCal = t - CAL_MS;
      let hipRise = 0;
      if (tAfterCal > 0 && tAfterCal < 3000) {
        hipRise = Math.min(0.15, (tAfterCal / 1500) * 0.15);
      }
      // Valgus during entire step-up attempt
      const valgus = tAfterCal > 0 && tAfterCal < 3000 ? VALGUS_RATIO : 0;
      engine.update(buildPose(hipRise, valgus), t);
    }
    engine.finish();

    expect(calibrated).toBe(true);
    const valgusWarnings = warnings.filter((w) => w.type === 'valgus');
    expect(valgusWarnings.length).toBeGreaterThan(0);
  });

  it('trunk-forward does NOT fire during STANDING phase', () => {
    const FPS = 30;
    const DT = 1000 / FPS;
    const TOTAL_MS = 4000;

    const warnings: Array<{ type: WarningType; atMs: number }> = [];
    let calibrated = false;

    const engine = new StepUpEngine({
      onCalibrationUpdate: (u) => { if (u.state === 'confirmed') calibrated = true; },
      onRepComplete: (_rep: StepUpRepEvent) => { /* noop */ },
      onPostureWarning: (type) => { warnings.push({ type, atMs: 0 }); },
    });

    for (let t = 0; t < TOTAL_MS; t += DT) {
      engine.update(buildPose(0, 0, 45), t);  // 45° lean, hipRise=0 (standing)
    }
    engine.finish();

    expect(calibrated).toBe(true);
    const trunkWarnings = warnings.filter((w) => w.type === 'trunk-forward');
    expect(trunkWarnings.length).toBe(0);
  });

  it('trunk-forward DOES fire when trunk lean is present during ASCENDING', () => {
    const FPS = 30;
    const DT = 1000 / FPS;
    const CAL_MS = 2200;
    const TOTAL_MS = CAL_MS + 4000;

    const warnings: Array<{ type: WarningType; atMs: number }> = [];
    let calibrated = false;
    let currentTMs = 0;

    const engine = new StepUpEngine({
      onCalibrationUpdate: (u) => { if (u.state === 'confirmed') calibrated = true; },
      onRepComplete: (_rep: StepUpRepEvent) => { /* noop */ },
      onPostureWarning: (type) => { warnings.push({ type, atMs: currentTMs }); },
    });

    for (let t = 0; t < TOTAL_MS; t += DT) {
      currentTMs = t;
      const tAfterCal = t - CAL_MS;
      let hipRise = 0;
      if (tAfterCal > 0 && tAfterCal < 3000) {
        hipRise = Math.min(0.15, (tAfterCal / 1500) * 0.15);
      }
      const trunkLean = tAfterCal > 0 && tAfterCal < 3000 ? 45 : 0;
      engine.update(buildPose(hipRise, 0, trunkLean), t);
    }
    engine.finish();

    expect(calibrated).toBe(true);
    const trunkWarnings = warnings.filter((w) => w.type === 'trunk-forward');
    expect(trunkWarnings.length).toBeGreaterThan(0);
  });
});
