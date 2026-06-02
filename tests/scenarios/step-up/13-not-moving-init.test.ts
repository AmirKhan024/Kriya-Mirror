/**
 * Regression test for round-5 §3.7 init-on-cal-confirm fix on Step-Up.
 *
 * Same pattern as lunge's 13-test: `standingSince = 0` at construction caused
 * the first post-cal frame to report `idleMs = (now - 0)` = millions, instantly
 * firing 'not-moving'. Fix initializes `standingSince = now` on cal-confirm.
 *
 * Fix I + Fix P: cold-start sentinel and initialization correctness.
 * NO_MOVEMENT_TIMEOUT_MS = 5000ms.
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

function buildStandingPose(): PoseLandmarks {
  const pose = emptyPose();
  const cx = 0.50;
  const shoulderW = 0.10;
  const baseAnkleY = 0.92;
  const bodyHeight = 0.70;
  const shoulderY = baseAnkleY - bodyHeight;
  const hipBaseY = shoulderY + bodyHeight * 0.55;
  // ankleXL/ankleXR: feet as wide as shoulders (feetWidthRatio=1.0)
  const ankleXL = cx - shoulderW;
  const ankleXR = cx + shoulderW;
  const hipXL = ankleXL;
  const hipXR = ankleXR;
  const kneeY = hipBaseY + (baseAnkleY - hipBaseY) * 0.5;
  const vis = 0.95;

  pose[IDX.leftShoulder] = makeLM(cx - shoulderW, shoulderY, vis);
  pose[IDX.rightShoulder] = makeLM(cx + shoulderW, shoulderY, vis);
  pose[IDX.leftElbow] = makeLM(cx - shoulderW - 0.05, shoulderY + 0.08, vis);
  pose[IDX.rightElbow] = makeLM(cx + shoulderW + 0.05, shoulderY + 0.08, vis);
  pose[IDX.leftWrist] = makeLM(cx - shoulderW - 0.05, shoulderY + 0.20, vis);
  pose[IDX.rightWrist] = makeLM(cx + shoulderW + 0.05, shoulderY + 0.20, vis);
  pose[IDX.leftHip] = makeLM(hipXL, hipBaseY, vis);
  pose[IDX.rightHip] = makeLM(hipXR, hipBaseY, vis);
  pose[IDX.leftKnee] = makeLM(hipXL - 0.01, kneeY, vis);
  pose[IDX.rightKnee] = makeLM(hipXR + 0.01, kneeY, vis);
  pose[IDX.leftAnkle] = makeLM(ankleXL, baseAnkleY, vis);
  pose[IDX.rightAnkle] = makeLM(ankleXR, baseAnkleY, vis);
  pose[IDX.leftHeel] = makeLM(ankleXL, baseAnkleY + 0.02, vis);
  pose[IDX.rightHeel] = makeLM(ankleXR, baseAnkleY + 0.02, vis);
  pose[IDX.leftFootIndex] = makeLM(ankleXL + 0.02, baseAnkleY + 0.03, vis);
  pose[IDX.rightFootIndex] = makeLM(ankleXR - 0.02, baseAnkleY + 0.03, vis);

  const noseY = shoulderY - 0.07;
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

describe('Step-Up — regression: no immediate "not-moving" after calibration (Fix I + Fix P)', () => {
  it('does NOT fire not-moving within the first 3s after calibration confirms', () => {
    // Calibration now confirms in ~200ms (instant-confirm). Run ~3
    // more seconds of stand-still. Total ~3.2s, under the 5s threshold.
    const FPS = 30;
    const DT = 1000 / FPS;
    const TOTAL_MS = 3200;

    const warnings: Array<{ type: WarningType; atMs: number }> = [];
    let calibrated = false;
    let calibratedAtMs: number | null = null;
    let currentTMs = 0;

    const engine = new StepUpEngine({
      onCalibrationUpdate: (u) => {
        if (u.state === 'confirmed' && !calibrated) {
          calibrated = true;
          calibratedAtMs = currentTMs;
        }
      },
      onRepComplete: (_rep: StepUpRepEvent) => { /* noop */ },
      onPostureWarning: (type) => {
        warnings.push({ type, atMs: currentTMs });
      },
    });

    for (let t = 0; t < TOTAL_MS; t += DT) {
      currentTMs = t;
      engine.update(buildStandingPose(), t);
    }
    engine.finish();

    expect(calibrated).toBe(true);
    expect(calibratedAtMs).not.toBeNull();
    expect(calibratedAtMs!).toBeLessThan(500);
    expect(countWarnings(warnings, 'not-moving')).toBe(0);
  });

  it('DOES fire not-moving after sustained idle past 5s post-calibration', () => {
    // Run 8.5 seconds of continuous standing — well past 5s threshold
    const FPS = 30;
    const DT = 1000 / FPS;
    const TOTAL_MS = 8500;

    const warnings: Array<{ type: WarningType; atMs: number }> = [];
    let calibrated = false;

    const engine = new StepUpEngine({
      onCalibrationUpdate: (u) => { if (u.state === 'confirmed') calibrated = true; },
      onRepComplete: (_rep: StepUpRepEvent) => { /* noop */ },
      onPostureWarning: (type) => { warnings.push({ type, atMs: 0 }); },
    });

    for (let t = 0; t < TOTAL_MS; t += DT) {
      engine.update(buildStandingPose(), t);
    }
    engine.finish();

    expect(calibrated).toBe(true);
    expect(countWarnings(warnings, 'not-moving')).toBeGreaterThan(0);
  });
});
