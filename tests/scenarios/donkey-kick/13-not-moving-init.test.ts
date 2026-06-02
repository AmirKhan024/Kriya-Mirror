/**
 * Donkey Kick — Fix I + Fix P: not-moving fires at init (first idle after calibration).
 * Verifies that 'not-moving' fires at 5s of idle after calibration confirms.
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
  // At rest: knee directly below hip, shin points left
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
// Tests
// ---------------------------------------------------------------------------
describe('Donkey Kick — not-moving fires at init (Fix I + Fix P)', () => {
  it('fires not-moving after 5s idle at AT_REST post-calibration', () => {
    // Calibrate, then idle for 7s — should fire not-moving
    const TOTAL_MS = CAL_MS + 7000;
    const frames: Frame[] = [];

    for (let t = 0; t < TOTAL_MS; t += DT) {
      frames.push({ landmarks: buildDKAtRest(), tMs: t });
    }

    const result = runDKLocal(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'not-moving')).toBeGreaterThanOrEqual(1);
  });

  it('does NOT fire not-moving in the first 3s after calibration confirms', () => {
    // Cal confirms within ~500ms. Total run = 3500ms.
    // Idle from cal confirm ≈ 3000ms < 5000ms threshold — not-moving must NOT fire.
    const TOTAL_MS = 3500;
    const frames: Frame[] = [];

    for (let t = 0; t < TOTAL_MS; t += DT) {
      frames.push({ landmarks: buildDKAtRest(), tMs: t });
    }

    const result = runDKLocal(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'not-moving')).toBe(0);
  });

  it('not-moving fires at the 5s mark (first fire is allowed by Fix P)', () => {
    // The cold-start Fix P ensures the FIRST 'not-moving' fires
    // even before NO_MOVEMENT_REPEAT_MS (15s) has elapsed.
    const TOTAL_MS = CAL_MS + 6000;
    const frames: Frame[] = [];

    for (let t = 0; t < TOTAL_MS; t += DT) {
      frames.push({ landmarks: buildDKAtRest(), tMs: t });
    }

    const result = runDKLocal(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'not-moving')).toBeGreaterThanOrEqual(1);
    // The first warning should fire around 5s after calibration confirm
    const firstWarn = result.warnings.find((w) => w.type === 'not-moving');
    expect(firstWarn).toBeDefined();
    // Should fire within ~2s of 5s threshold (allowing for EMA settle time)
    const calConfirmedAt = result.calibrationConfirmedAtMs ?? 0;
    expect(firstWarn!.atMs - calConfirmedAt).toBeGreaterThanOrEqual(4500);
  });
});
