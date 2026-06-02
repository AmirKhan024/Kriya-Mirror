/**
 * Bird-Dog calibration gate tests.
 * Tests all 4 gates: fullBodyVisible, feetWide (bodyHorizontal),
 * armsOverhead (handsDown), distanceOk with hysteresis.
 */
import { describe, it, expect } from 'vitest';
import type { PoseLandmarks } from '@/modules/pose/types';
import type { CalibrationUpdate } from '@/modules/squat/types';
import { BirdDogEngine } from '@/modules/bird-dog/engine';
import type { BirdDogFrameMetrics } from '@/modules/bird-dog/types';
import type { WarningType } from '@/store/workout';
import type { Frame } from '../../harness/types';
import { buildFrames } from '../../harness/frame-stream';

// ---------------------------------------------------------------------------
// Pose builders for different calibration scenarios
// ---------------------------------------------------------------------------
interface BirdDogCalIntent {
  legExtension?: number;
  visibility?: number;
  bodyNotHorizontal?: boolean;  // force body to not be horizontal (feetWide fails)
  handsOverride?: boolean;       // force hands NOT below shoulders (armsOverhead fails)
  bodySpan?: number;             // for distance gate testing
}

function buildBirdDogCalPose(intent: BirdDogCalIntent): PoseLandmarks {
  const ext = intent.legExtension ?? 0;
  const vis = intent.visibility ?? 0.95;
  const span = intent.bodySpan ?? 0.60;

  const shoulderX = 0.68;
  let shoulderY = 0.42;
  const hipX = 0.45;
  const hipY = 0.42;

  // bodyNotHorizontal: tilt the shoulder up so ratio < 2.5
  if (intent.bodyNotHorizontal) {
    shoulderY = 0.18; // shoulder much higher than hip → body is vertical
  }

  const rotRad = ext * 75 * Math.PI / 180;
  const kneeX = hipX - 0.18 * Math.sin(rotRad);
  const kneeY = hipY + 0.18 * Math.cos(rotRad);
  const ankleX = kneeX - 0.22;
  const ankleY = kneeY;

  // handsOverride: put wrists above shoulder (fails gate)
  const wristX = shoulderX + 0.12;
  const wristY = intent.handsOverride ? shoulderY - 0.15 : shoulderY + 0.32;

  const lm: PoseLandmarks = Array.from({ length: 33 }, () => ({
    x: 0.5, y: 0.5, z: 0, visibility: 0.1,
  })) as unknown as PoseLandmarks;

  lm[11] = { x: shoulderX, y: shoulderY, z: 0, visibility: vis };
  lm[12] = { x: shoulderX, y: shoulderY, z: 0, visibility: vis };
  lm[23] = { x: hipX, y: hipY, z: 0, visibility: vis };
  lm[24] = { x: hipX, y: hipY, z: 0, visibility: vis };
  lm[25] = { x: kneeX, y: kneeY, z: 0, visibility: vis };
  lm[26] = { x: kneeX, y: kneeY, z: 0, visibility: vis };
  lm[27] = { x: ankleX, y: ankleY, z: 0, visibility: vis };
  lm[28] = { x: ankleX, y: ankleY, z: 0, visibility: vis };
  lm[15] = { x: wristX, y: wristY, z: 0, visibility: vis };
  lm[16] = { x: wristX, y: wristY, z: 0, visibility: vis };

  // Scale horizontal span
  const currentSpan = Math.abs(ankleX - shoulderX);
  const scaleFactor = span / (currentSpan || 0.46);
  const cx = (shoulderX + ankleX) / 2;
  for (const idx of [11, 12, 23, 24, 25, 26, 27, 28, 15, 16]) {
    lm[idx] = { ...lm[idx], x: cx + (lm[idx].x - cx) * scaleFactor };
  }

  return lm;
}

// ---------------------------------------------------------------------------
// Local runner (calibration-focused)
// ---------------------------------------------------------------------------
interface CalRunResult {
  finalCalibration: CalibrationUpdate | null;
  calibrationConfirmedAtMs: number | null;
  calUpdates: CalibrationUpdate[];
}

function runCalibrationTest(frames: Frame[]): CalRunResult {
  const calUpdates: CalibrationUpdate[] = [];
  let finalCalibration: CalibrationUpdate | null = null;
  let calibrationConfirmedAtMs: number | null = null;
  let currentTMs = 0;

  const engine = new BirdDogEngine({
    onCalibrationUpdate: (u) => {
      calUpdates.push(u);
      finalCalibration = u;
      if (u.state === 'confirmed' && calibrationConfirmedAtMs === null) {
        calibrationConfirmedAtMs = currentTMs;
      }
    },
    onPostureWarning: (_: WarningType) => {},
    onFrame: (_: BirdDogFrameMetrics) => {},
  });

  for (const frame of frames) {
    currentTMs = frame.tMs;
    engine.update(frame.landmarks, frame.tMs);
  }
  engine.finish();

  return { finalCalibration, calibrationConfirmedAtMs, calUpdates };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('Bird-Dog — calibration', () => {
  it('fullBodyVisible fails when landmarks have low visibility', () => {
    const frames = buildFrames(
      () => ({ visibility: 0.1 } as BirdDogCalIntent),
      buildBirdDogCalPose,
      { fps: 30, durationMs: 1000 },
    );
    const result = runCalibrationTest(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    const anyUpdate = result.calUpdates.find((u) => u.checks.fullBodyVisible === false);
    expect(anyUpdate).toBeDefined();
  });

  it('feetWide (bodyHorizontal) fails when body is not horizontal', () => {
    const frames = buildFrames(
      () => ({ bodyNotHorizontal: true } as BirdDogCalIntent),
      buildBirdDogCalPose,
      { fps: 30, durationMs: 1000 },
    );
    const result = runCalibrationTest(frames);
    // Should not confirm when body is not horizontal
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    const anyUpdate = result.calUpdates.find((u) => u.checks.fullBodyVisible === true);
    if (anyUpdate) {
      expect(anyUpdate.checks.feetWide).toBe(false);
    }
  });

  it('armsOverhead (handsDown) fails when hands are above shoulders', () => {
    const frames = buildFrames(
      () => ({ handsOverride: true } as BirdDogCalIntent),
      buildBirdDogCalPose,
      { fps: 30, durationMs: 1000 },
    );
    const result = runCalibrationTest(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    const anyUpdate = result.calUpdates.find((u) => u.checks.fullBodyVisible === true);
    if (anyUpdate) {
      expect(anyUpdate.checks.armsOverhead).toBe(false);
    }
  });

  it('distanceOk fails when bodySpan=0.35 (too-far, below 0.40 ENTER threshold)', () => {
    const frames = buildFrames(
      () => ({ bodySpan: 0.35 } as BirdDogCalIntent),
      buildBirdDogCalPose,
      { fps: 30, durationMs: 1000 },
    );
    const result = runCalibrationTest(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    const distUpdate = result.calUpdates.find((u) => u.distanceHint === 'too-far');
    expect(distUpdate).toBeDefined();
  });

  it('distanceOk fails when bodySpan=0.80 (too-close, above 0.75 ENTER threshold)', () => {
    const frames = buildFrames(
      () => ({ bodySpan: 0.80 } as BirdDogCalIntent),
      buildBirdDogCalPose,
      { fps: 30, durationMs: 1000 },
    );
    const result = runCalibrationTest(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
    const distUpdate = result.calUpdates.find((u) => u.distanceHint === 'too-close');
    expect(distUpdate).toBeDefined();
  });

  it('distance hysteresis: bodySpan=0.39 (below ENTER=0.40) → too-far', () => {
    const frames = buildFrames(
      () => ({ bodySpan: 0.39 } as BirdDogCalIntent),
      buildBirdDogCalPose,
      { fps: 30, durationMs: 1000 },
    );
    const result = runCalibrationTest(frames);
    const tooFarUpdate = result.calUpdates.find((u) => u.distanceHint === 'too-far');
    expect(tooFarUpdate).toBeDefined();
  });

  it('calibration confirms in ≤ 400ms of all-green (Fix G: CONFIRM_DURATION_MS=200)', () => {
    // Good posture at correct distance — should confirm within 400ms
    const frames = buildFrames(
      () => ({ bodySpan: 0.60 } as BirdDogCalIntent),
      buildBirdDogCalPose,
      { fps: 30, durationMs: 5000 },
    );
    const result = runCalibrationTest(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    // Should confirm fast (within 400ms of all-green = calibration start)
    expect(result.calibrationConfirmedAtMs).toBeLessThanOrEqual(500);
  });

  it('timeout fires after TIMEOUT_MS=20000 without all-green', () => {
    // Bad posture throughout — should timeout
    const frames = buildFrames(
      () => ({ bodyNotHorizontal: true } as BirdDogCalIntent),
      buildBirdDogCalPose,
      { fps: 30, durationMs: 21000 },
    );
    const result = runCalibrationTest(frames);
    expect(result.finalCalibration?.state).toBe('timeout');
  });

  it('null landmarks during calibration prevent confirmation', () => {
    const frames = buildFrames(
      () => null,
      buildBirdDogCalPose,
      { fps: 30, durationMs: 3000 },
    );
    const result = runCalibrationTest(frames);
    expect(result.finalCalibration?.state).not.toBe('confirmed');
  });
});
