/**
 * Regression test for Fix N (position-lost warning) on Step-Up.
 *
 * Spec: if no usable pose frame (landmarks null OR core body landmarks
 * not visible) for ≥ 3 seconds post-calibration, the engine emits
 * `position-lost`. Repeats at most every 10s while still lost.
 *
 * Mirror of lunge's 17-position-lost.test.ts.
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

function runSession(
  frameBuilder: (tMs: number) => PoseLandmarks | null,
  durationMs: number,
  fps = 30,
): {
  warnings: Array<{ type: WarningType; atMs: number }>;
  calibrated: boolean;
  calibratedAtMs: number | null;
} {
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
    onPostureWarning: (type) => { warnings.push({ type, atMs: currentTMs }); },
  });

  const dt = 1000 / fps;
  for (let t = 0; t < durationMs; t += dt) {
    currentTMs = t;
    engine.update(frameBuilder(t), t);
  }
  engine.finish();

  return { warnings, calibrated, calibratedAtMs };
}

const CAL_MS = 2200;

describe('Step-Up — position-lost warning (Fix N)', () => {
  it('fires position-lost after 3+ seconds of null landmarks post-calibration', () => {
    // Calibrate for 2.2s (clean pose), then return null landmarks for 4s.
    const { warnings, calibrated } = runSession(
      (tMs) => tMs < CAL_MS ? buildStandingPose() : null,
      CAL_MS + 4000,
    );

    expect(calibrated).toBe(true);
    expect(countWarnings(warnings, 'position-lost')).toBeGreaterThan(0);
  });

  it('does NOT fire position-lost on a clean continuous stream', () => {
    const { warnings } = runSession(
      () => buildStandingPose(),
      4000,
    );

    expect(countWarnings(warnings, 'position-lost')).toBe(0);
  });

  it('does NOT fire position-lost during the brief calibration phase', () => {
    // Null frames DURING calibration should not trigger position-lost
    // since the engine isn't confirmed yet. Then pose comes into frame.
    const { warnings } = runSession(
      (tMs) => {
        if (tMs < 1500) return null;
        return buildStandingPose();
      },
      3000,
    );

    expect(countWarnings(warnings, 'position-lost')).toBe(0);
  });

  it('does NOT re-fire position-lost within the 10s cooldown', () => {
    // 5 seconds of null post-cal — should fire exactly once (at ~3s mark).
    const { warnings, calibrated } = runSession(
      (tMs) => tMs < CAL_MS ? buildStandingPose() : null,
      CAL_MS + 5000,
    );

    expect(calibrated).toBe(true);
    expect(countWarnings(warnings, 'position-lost')).toBe(1);
  });

  it('re-fires position-lost after 10s cooldown has expired', () => {
    // 15+ seconds of null post-cal: fires at ~3s, then again at ~13s.
    const { warnings, calibrated } = runSession(
      (tMs) => tMs < CAL_MS ? buildStandingPose() : null,
      CAL_MS + 14000,
    );

    expect(calibrated).toBe(true);
    expect(countWarnings(warnings, 'position-lost')).toBeGreaterThanOrEqual(2);
  });
});
