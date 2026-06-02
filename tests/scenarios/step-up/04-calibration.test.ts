/**
 * Step-Up — calibration gate tests.
 *
 * Tests:
 *   - fullBodyVisible: fails with occluded knee landmarks
 *   - feetHipWidth: fails with feetWidthRatio=0.50 (feet too close together)
 *   - feetHipWidth: fails with feetWidthRatio=1.50 (feet too wide)
 *   - feetHipWidth: passes with feetWidthRatio=1.00 (hip-width)
 *   - armsAtSides: fails when wrists at shoulder height (armsOverhead)
 *   - distanceOk: fails bodyHeight=0.35 (too small = too far away)
 *   - Calibration confirms in ≤ 400ms of all-green (Fix G)
 *   - Timeout fires at 20s (when always failing)
 */
import { describe, it, expect } from 'vitest';
import { StepUpEngine } from '@/modules/step-up/engine';
import type { StepUpRepEvent } from '@/modules/step-up/types';
import type { CalibrationUpdate } from '@/modules/squat/types';
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

function buildCalibrationPose(opts: {
  feetWidthRatio?: number;
  armsAtSides?: boolean;
  bodyHeight?: number;
  occludedIndices?: number[];
  vis?: number;
} = {}): PoseLandmarks {
  const {
    feetWidthRatio = 1.0,
    armsAtSides = true,
    bodyHeight = 0.70,
    occludedIndices,
    vis = 0.95,
  } = opts;

  const pose = emptyPose();
  const cx = 0.50;
  const shoulderW = 0.10;
  const baseAnkleY = 0.92;
  const shoulderY = baseAnkleY - bodyHeight;
  const hipBaseY = shoulderY + bodyHeight * 0.55;
  // ankleXL/ankleXR: feetWidthRatio=1.0 → feet as wide as shoulders (2*shoulderW)
  const ankleXL = cx - shoulderW * feetWidthRatio;
  const ankleXR = cx + shoulderW * feetWidthRatio;
  const hipXL = ankleXL;
  const hipXR = ankleXR;
  const kneeY = hipBaseY + (baseAnkleY - hipBaseY) * 0.5;

  pose[IDX.leftShoulder] = makeLM(cx - shoulderW, shoulderY, vis);
  pose[IDX.rightShoulder] = makeLM(cx + shoulderW, shoulderY, vis);
  pose[IDX.leftElbow] = makeLM(cx - shoulderW - 0.05, shoulderY + 0.08, vis);
  pose[IDX.rightElbow] = makeLM(cx + shoulderW + 0.05, shoulderY + 0.08, vis);

  if (armsAtSides) {
    // Wrists below shoulders (arms relaxed at sides)
    pose[IDX.leftWrist] = makeLM(cx - shoulderW - 0.05, shoulderY + 0.20, vis);
    pose[IDX.rightWrist] = makeLM(cx + shoulderW + 0.05, shoulderY + 0.20, vis);
  } else {
    // Wrists at shoulder height (fails armsAtSides gate)
    pose[IDX.leftWrist] = makeLM(cx - shoulderW - 0.05, shoulderY - 0.01, vis);
    pose[IDX.rightWrist] = makeLM(cx + shoulderW + 0.05, shoulderY - 0.01, vis);
  }

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

  if (occludedIndices) {
    for (const i of occludedIndices) {
      if (pose[i]) pose[i].visibility = 0;
    }
  }

  return pose;
}

function runCalibrationOnly(
  poseBuilder: (tMs: number) => PoseLandmarks | null,
  durationMs: number,
  fps = 30,
): {
  finalCalibration: CalibrationUpdate | null;
  calibrationConfirmedAtMs: number | null;
  calUpdates: CalibrationUpdate[];
} {
  const calUpdates: CalibrationUpdate[] = [];
  let finalCalibration: CalibrationUpdate | null = null;
  let calibrationConfirmedAtMs: number | null = null;
  let currentTMs = 0;

  const engine = new StepUpEngine({
    onCalibrationUpdate: (u) => {
      finalCalibration = u;
      calUpdates.push(u);
      if (u.state === 'confirmed' && calibrationConfirmedAtMs === null) {
        calibrationConfirmedAtMs = currentTMs;
      }
    },
    onRepComplete: (_rep: StepUpRepEvent) => { /* noop */ },
  });

  const dt = 1000 / fps;
  for (let t = 0; t < durationMs; t += dt) {
    currentTMs = t;
    engine.update(poseBuilder(t), t);
  }
  engine.finish();

  return { finalCalibration, calibrationConfirmedAtMs, calUpdates };
}

describe('Step-Up — calibration gates', () => {
  it('fails fullBodyVisible when knee landmarks are occluded', () => {
    const { finalCalibration } = runCalibrationOnly(
      () => buildCalibrationPose({ occludedIndices: [IDX.leftKnee, IDX.rightKnee] }),
      3000,
    );
    expect(finalCalibration?.state).not.toBe('confirmed');
    expect(finalCalibration?.checks.fullBodyVisible).toBe(false);
  });

  it('fails feetHipWidth when feetWidthRatio=0.50 (feet too close)', () => {
    const { finalCalibration } = runCalibrationOnly(
      () => buildCalibrationPose({ feetWidthRatio: 0.50 }),
      3000,
    );
    expect(finalCalibration?.state).not.toBe('confirmed');
    expect(finalCalibration?.checks.feetWide).toBe(false);
  });

  it('fails feetHipWidth when feetWidthRatio=1.50 (feet too wide)', () => {
    const { finalCalibration } = runCalibrationOnly(
      () => buildCalibrationPose({ feetWidthRatio: 1.50 }),
      3000,
    );
    expect(finalCalibration?.state).not.toBe('confirmed');
    expect(finalCalibration?.checks.feetWide).toBe(false);
  });

  it('passes feetHipWidth when feetWidthRatio=1.00 (hip-width)', () => {
    const { finalCalibration, calibrationConfirmedAtMs } = runCalibrationOnly(
      () => buildCalibrationPose({ feetWidthRatio: 1.00 }),
      2000,
    );
    expect(finalCalibration?.state).toBe('confirmed');
    expect(calibrationConfirmedAtMs).not.toBeNull();
  });

  it('fails armsAtSides when wrists are at shoulder height', () => {
    const { finalCalibration } = runCalibrationOnly(
      () => buildCalibrationPose({ armsAtSides: false }),
      3000,
    );
    expect(finalCalibration?.state).not.toBe('confirmed');
    expect(finalCalibration?.checks.armsOverhead).toBe(false);
  });

  it('fails distanceOk when bodyHeight=0.35 (too far away)', () => {
    const { finalCalibration } = runCalibrationOnly(
      () => buildCalibrationPose({ bodyHeight: 0.35 }),
      3000,
    );
    expect(finalCalibration?.state).not.toBe('confirmed');
    expect(finalCalibration?.checks.distanceOk).toBe(false);
    expect(finalCalibration?.distanceHint).toBe('too-far');
  });

  it('fails distanceOk when bodyHeight=0.95 (too close)', () => {
    const { finalCalibration } = runCalibrationOnly(
      () => buildCalibrationPose({ bodyHeight: 0.95 }),
      3000,
    );
    expect(finalCalibration?.state).not.toBe('confirmed');
    expect(finalCalibration?.checks.distanceOk).toBe(false);
    expect(finalCalibration?.distanceHint).toBe('too-close');
  });

  it('calibration confirms in ≤ 400ms of all-green pose (Fix G — instant confirm)', () => {
    const GOOD_START = 500;
    const { calibrationConfirmedAtMs } = runCalibrationOnly(
      (tMs) => {
        if (tMs < GOOD_START) {
          // Fail one gate before good start
          return buildCalibrationPose({ armsAtSides: false });
        }
        return buildCalibrationPose();
      },
      3000,
    );
    expect(calibrationConfirmedAtMs).not.toBeNull();
    // Should confirm within 400ms of GOOD_START
    expect(calibrationConfirmedAtMs!).toBeLessThan(GOOD_START + 400);
  });

  it('calibration times out at ~20s if gates never pass', () => {
    const { finalCalibration } = runCalibrationOnly(
      () => buildCalibrationPose({ armsAtSides: false }),
      21000,  // 21 seconds — past the 20s timeout
    );
    expect(finalCalibration?.state).toBe('timeout');
  });
});
