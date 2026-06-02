/**
 * Donkey Kick — calibration tests.
 * (a) body not horizontal → feetWide gate fails
 * (b) hands raised → armsOverhead gate fails
 * (c) distanceHint when body too far
 * (d) confirms ~200ms when all gates green
 */
import { describe, it, expect } from 'vitest';
import type { PoseLandmarks } from '@/modules/pose/types';
import type { CalibrationUpdate } from '@/modules/squat/types';
import { DonkeyKickEngine } from '@/modules/donkey-kick/engine';
import type { WarningType } from '@/store/workout';
import type { Frame } from '../../harness/types';

const FPS = 30;
const DT = 1000 / FPS;

// ---------------------------------------------------------------------------
// Pose builders for calibration testing
// ---------------------------------------------------------------------------
function buildCalPose(opts: {
  bodyHorizontal?: boolean;
  handsDown?: boolean;
  bodySpan?: number;
}): PoseLandmarks {
  const {
    bodyHorizontal = true,
    handsDown = true,
    bodySpan = 0.60,
  } = opts;

  const vis = 0.95;
  const SHOULDER_X = 0.68;
  const SHOULDER_Y = 0.42;
  const HIP_X = 0.45;
  const L_THIGH = 0.18;
  const L_SHIN = 0.18;

  // Body horizontal: hip.y = shoulder.y (quadruped)
  // Body NOT horizontal: standing/kneeling (hip far BELOW shoulder in screen = large Y difference)
  // Need large Y difference to fail the horizontal ratio: torsoX/torsoY < 2.5
  const HIP_Y = bodyHorizontal ? SHOULDER_Y : SHOULDER_Y + 0.25; // standing: hip much lower than shoulder

  // At rest: knee below hip, ankle behind knee
  const kneeX = HIP_X;
  const kneeY = HIP_Y + L_THIGH;
  const ankleX = kneeX - L_SHIN;
  const ankleY = kneeY + L_SHIN * 0.3;

  // Wrist position
  const wristY = handsDown ? SHOULDER_Y + 0.32 : SHOULDER_Y - 0.10; // raised if not handsDown
  const wristX = SHOULDER_X + 0.12;

  // Apply scale for bodySpan
  const currentSpan = Math.abs(ankleX - SHOULDER_X);
  const scale = bodySpan / (currentSpan || 0.41);
  const cxLocal = (SHOULDER_X + ankleX) / 2;

  const lm: PoseLandmarks = Array.from({ length: 33 }, () => ({
    x: 0.5, y: 0.5, z: 0, visibility: 0.1,
  })) as unknown as PoseLandmarks;

  function scaleXLocal(x: number) { return cxLocal + (x - cxLocal) * scale; }

  lm[11] = { x: scaleXLocal(SHOULDER_X), y: SHOULDER_Y, z: 0, visibility: vis };
  lm[12] = { x: scaleXLocal(SHOULDER_X), y: SHOULDER_Y + 0.01, z: 0, visibility: vis * 0.7 };
  lm[23] = { x: scaleXLocal(HIP_X), y: HIP_Y, z: 0, visibility: vis };
  lm[24] = { x: scaleXLocal(HIP_X), y: HIP_Y + 0.01, z: 0, visibility: vis * 0.7 };
  lm[25] = { x: scaleXLocal(kneeX), y: kneeY, z: 0, visibility: vis };
  lm[26] = { x: scaleXLocal(HIP_X), y: kneeY, z: 0, visibility: vis * 0.6 };
  lm[27] = { x: scaleXLocal(ankleX), y: ankleY, z: 0, visibility: vis };
  lm[28] = { x: scaleXLocal(ankleX + 0.03), y: ankleY, z: 0, visibility: vis * 0.6 };
  lm[15] = { x: scaleXLocal(wristX), y: wristY, z: 0, visibility: vis };
  lm[16] = { x: scaleXLocal(wristX - 0.35), y: wristY, z: 0, visibility: vis * 0.7 };

  return lm;
}

// ---------------------------------------------------------------------------
// Local runner (returns only calibration updates)
// ---------------------------------------------------------------------------
interface CalResult {
  finalCalibration: CalibrationUpdate | null;
  calibrationConfirmedAtMs: number | null;
}

function runCalOnly(frames: Frame[]): CalResult {
  let finalCalibration: CalibrationUpdate | null = null;
  let calibrationConfirmedAtMs: number | null = null;
  let currentTMs = 0;

  const engine = new DonkeyKickEngine({
    onCalibrationUpdate: (u) => {
      finalCalibration = u;
      if (u.state === 'confirmed' && calibrationConfirmedAtMs === null) {
        calibrationConfirmedAtMs = currentTMs;
      }
    },
    onPostureWarning: (_: WarningType) => {},
  });

  for (const frame of frames) {
    currentTMs = frame.tMs;
    engine.update(frame.landmarks, frame.tMs);
  }
  engine.finish();

  return { finalCalibration, calibrationConfirmedAtMs };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('Donkey Kick — calibration gates', () => {
  it('(a) body not horizontal → feetWide gate fails, calibration does not confirm', () => {
    // Build frames with body tilted (not horizontal quadruped)
    const frames: Frame[] = [];
    for (let t = 0; t < 3000; t += DT) {
      frames.push({ landmarks: buildCalPose({ bodyHorizontal: false }), tMs: t });
    }

    const result = runCalOnly(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.checks.feetWide).toBe(false);
  });

  it('(b) hands raised → armsOverhead gate fails, calibration does not confirm', () => {
    const frames: Frame[] = [];
    for (let t = 0; t < 3000; t += DT) {
      frames.push({ landmarks: buildCalPose({ handsDown: false }), tMs: t });
    }

    const result = runCalOnly(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    expect(result.finalCalibration?.checks.armsOverhead).toBe(false);
  });

  it('(c) body too small (too far from camera) → distanceHint = too-far', () => {
    // bodySpan=0.12 → knee-to-shoulder dx ≈ 0.067, well below MIN_ENTER=0.25
    const frames: Frame[] = [];
    for (let t = 0; t < 3000; t += DT) {
      frames.push({ landmarks: buildCalPose({ bodySpan: 0.12 }), tMs: t });
    }

    const result = runCalOnly(frames);
    expect(result.finalCalibration?.distanceHint).toBe('too-far');
    expect(result.finalCalibration?.checks.distanceOk).toBe(false);
  });

  it('(d) all gates green → confirms within 500ms', () => {
    // Standard calibration pose — all gates pass
    const frames: Frame[] = [];
    for (let t = 0; t < 1000; t += DT) {
      frames.push({ landmarks: buildCalPose({}), tMs: t });
    }

    const result = runCalOnly(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).not.toBeNull();
    expect(result.calibrationConfirmedAtMs!).toBeLessThanOrEqual(500);
  });

  it('all gates pass → all checks are true', () => {
    const frames: Frame[] = [];
    for (let t = 0; t < 600; t += DT) {
      frames.push({ landmarks: buildCalPose({}), tMs: t });
    }

    const result = runCalOnly(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.finalCalibration?.checks.fullBodyVisible).toBe(true);
    expect(result.finalCalibration?.checks.feetWide).toBe(true);
    expect(result.finalCalibration?.checks.armsOverhead).toBe(true);
    expect(result.finalCalibration?.checks.distanceOk).toBe(true);
  });

  it('(e) body too large (too close to camera) → distanceHint = too-close', () => {
    // buildCalPose uses ankle-to-shoulder as currentSpan (0.41). After the fix, dx = knee-to-shoulder.
    // Knee-to-shoulder is 56% of ankle-to-shoulder in this helper, so bodySpan > 1.03 is needed
    // to push the knee-based dx above MAX_ENTER=0.58. bodySpan=1.1 → dx ≈ 0.617.
    const frames: Frame[] = [];
    for (let t = 0; t < 3000; t += DT) {
      frames.push({ landmarks: buildCalPose({ bodySpan: 1.1 }), tMs: t });
    }

    const result = runCalOnly(frames);
    expect(result.finalCalibration?.distanceHint).toBe('too-close');
    expect(result.finalCalibration?.checks.distanceOk).toBe(false);
  });

  it('(f) failing fullBodyVisible → mostBlockingGate = no-body', () => {
    const frames: Frame[] = [];
    for (let t = 0; t < 1000; t += DT) {
      frames.push({ landmarks: null, tMs: t });
    }

    const result = runCalOnly(frames);
    expect(result.finalCalibration?.mostBlockingGate).toBe('no-body');
  });

  it('(g) all gates pass → mostBlockingGate = null', () => {
    const frames: Frame[] = [];
    for (let t = 0; t < 600; t += DT) {
      frames.push({ landmarks: buildCalPose({}), tMs: t });
    }

    const result = runCalOnly(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.finalCalibration?.mostBlockingGate).toBeNull();
  });
});
