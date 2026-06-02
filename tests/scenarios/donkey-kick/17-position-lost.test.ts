/**
 * Regression tests for Donkey Kick Fix N — position-lost warning.
 *
 * Spec: if no usable pose frame (landmarks null OR core body landmarks not
 * visible) for ≥ 3 seconds post-calibration, the engine emits 'position-lost'.
 * Repeats at most every 10s while the pose is still absent.
 */
import { describe, it, expect } from 'vitest';
import type { PoseLandmarks } from '@/modules/pose/types';
import type { CalibrationUpdate } from '@/modules/squat/types';
import { DonkeyKickEngine } from '@/modules/donkey-kick/engine';
import type { WarningType } from '@/store/workout';
import type { Frame } from '../../harness/types';

const CAL_MS = 2200;
const FPS = 30;
const DT = 1000 / FPS;

// ---------------------------------------------------------------------------
// Pose builders
// ---------------------------------------------------------------------------
function buildDKAtRest(): PoseLandmarks {
  const vis = 0.95;
  const lm: PoseLandmarks = Array.from({ length: 33 }, () => ({
    x: 0.5, y: 0.5, z: 0, visibility: 0.1,
  })) as unknown as PoseLandmarks;
  const SHOULDER_X = 0.68;
  const SHOULDER_Y = 0.42;
  const HIP_X = 0.40; // 0.45→0.40: knee-to-shoulder dx=0.28 passes MIN_ENTER=0.25 after BUG-DK-CAL-02/03
  const HIP_Y = 0.42;
  const L_THIGH = 0.18;
  const L_SHIN = 0.18;
  const kneeX = HIP_X;
  const kneeY = HIP_Y + L_THIGH;
  const ankleX = kneeX - L_SHIN;
  const ankleY = kneeY + L_SHIN * 0.3;

  lm[11] = { x: SHOULDER_X, y: SHOULDER_Y, z: 0, visibility: vis };
  lm[12] = { x: SHOULDER_X, y: SHOULDER_Y + 0.01, z: 0, visibility: vis * 0.7 };
  lm[23] = { x: HIP_X, y: HIP_Y, z: 0, visibility: vis };
  lm[24] = { x: HIP_X, y: HIP_Y + 0.01, z: 0, visibility: vis * 0.7 };
  lm[25] = { x: kneeX, y: kneeY, z: 0, visibility: vis };
  lm[26] = { x: HIP_X, y: kneeY, z: 0, visibility: vis * 0.6 };
  lm[27] = { x: ankleX, y: ankleY, z: 0, visibility: vis };
  lm[28] = { x: ankleX + 0.03, y: ankleY, z: 0, visibility: vis * 0.6 };
  lm[15] = { x: SHOULDER_X + 0.12, y: SHOULDER_Y + 0.32, z: 0, visibility: vis };
  lm[16] = { x: SHOULDER_X - 0.23, y: SHOULDER_Y + 0.32, z: 0, visibility: vis * 0.7 };
  return lm;
}

// ---------------------------------------------------------------------------
// Local runner
// ---------------------------------------------------------------------------
interface RunResult {
  warnings: Array<{ type: WarningType; atMs: number }>;
  finalCalibration: CalibrationUpdate | null;
  calibrationConfirmedAtMs: number | null;
}

function runDKLocal(frames: Frame[]): RunResult {
  const warnings: Array<{ type: WarningType; atMs: number }> = [];
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
    onPostureWarning: (type) => warnings.push({ type, atMs: currentTMs }),
  });

  for (const frame of frames) {
    currentTMs = frame.tMs;
    engine.update(frame.landmarks, frame.tMs);
  }
  engine.finish();

  return { warnings, finalCalibration, calibrationConfirmedAtMs };
}

function countWarnings(result: RunResult, type: WarningType): number {
  return result.warnings.filter((w) => w.type === type).length;
}

// ---------------------------------------------------------------------------
// Frame stream helpers
// ---------------------------------------------------------------------------
function buildCalibrationFrames(): Frame[] {
  const frames: Frame[] = [];
  for (let t = 0; t < CAL_MS; t += DT) {
    frames.push({ landmarks: buildDKAtRest(), tMs: t });
  }
  return frames;
}

function buildNullFrames(startMs: number, durationMs: number): Frame[] {
  const frames: Frame[] = [];
  for (let t = 0; t < durationMs; t += DT) {
    frames.push({ landmarks: null, tMs: startMs + t });
  }
  return frames;
}

function buildValidFrames(startMs: number, durationMs: number): Frame[] {
  const frames: Frame[] = [];
  for (let t = 0; t < durationMs; t += DT) {
    frames.push({ landmarks: buildDKAtRest(), tMs: startMs + t });
  }
  return frames;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('Donkey Kick — position-lost warning (Fix N)', () => {
  it('fires position-lost after 3+ seconds of null landmarks post-calibration', () => {
    const calFrames = buildCalibrationFrames();
    const nullFrames = buildNullFrames(CAL_MS, 4000); // 4s of null post-cal

    const result = runDKLocal([...calFrames, ...nullFrames]);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'position-lost')).toBeGreaterThan(0);
  });

  it('does NOT fire position-lost on a clean continuous stream', () => {
    const frames = buildValidFrames(0, 5000); // 5s of valid frames
    const result = runDKLocal(frames);
    expect(countWarnings(result, 'position-lost')).toBe(0);
  });

  it('does NOT fire position-lost during the calibration phase (before confirm)', () => {
    // Null frames during calibration phase → position-lost must NOT fire
    const nullDuringCal: Frame[] = [];
    for (let t = 0; t < 1500; t += DT) {
      nullDuringCal.push({ landmarks: null, tMs: t });
    }
    // Come into frame at 1.5s; calibration proceeds from here
    const calAfter = buildValidFrames(1500, 2500);

    const result = runDKLocal([...nullDuringCal, ...calAfter]);
    expect(countWarnings(result, 'position-lost')).toBe(0);
  });

  it('does NOT re-fire position-lost within the 10s cooldown', () => {
    // 5s of null post-cal — should fire exactly once (at the 3s mark)
    // The 10s cooldown prevents a second fire within this window
    const calFrames = buildCalibrationFrames();
    const nullFrames = buildNullFrames(CAL_MS, 5000);

    const result = runDKLocal([...calFrames, ...nullFrames]);
    expect(countWarnings(result, 'position-lost')).toBe(1);
  });

  it('fires again after 10s cooldown has elapsed', () => {
    // 15s of null post-cal — should fire twice (at ~3s and ~13s)
    const calFrames = buildCalibrationFrames();
    const nullFrames = buildNullFrames(CAL_MS, 15000);

    const result = runDKLocal([...calFrames, ...nullFrames]);
    expect(countWarnings(result, 'position-lost')).toBeGreaterThanOrEqual(2);
  });

  it('stops firing position-lost when valid landmarks resume', () => {
    // 4s null → 3s valid → total should be exactly 1 position-lost
    const calFrames = buildCalibrationFrames();
    const nullFrames = buildNullFrames(CAL_MS, 4000);
    const resumeFrames = buildValidFrames(CAL_MS + 4000, 3000);

    const result = runDKLocal([...calFrames, ...nullFrames, ...resumeFrames]);
    expect(countWarnings(result, 'position-lost')).toBe(1);
  });
});
