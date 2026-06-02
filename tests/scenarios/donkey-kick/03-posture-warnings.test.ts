/**
 * Donkey Kick — posture warning tests.
 * (a) Fix A: no warnings during AT_REST state (engine only emits warnings at rep-close)
 * (b) No continuous per-frame posture warnings in v1 (donkey kick has none)
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
// Pose builder
// ---------------------------------------------------------------------------
function buildDKPose(thighLiftDeg: number): PoseLandmarks {
  const liftDeg = Math.max(0, thighLiftDeg);
  const vis = 0.95;
  const SHOULDER_X = 0.68;
  const SHOULDER_Y = 0.42;
  const HIP_X = 0.40; // 0.45→0.40: knee-to-shoulder dx=0.28 passes MIN_ENTER=0.25 after BUG-DK-CAL-02/03
  const HIP_Y = 0.42;
  const L_THIGH = 0.18;
  const L_SHIN = 0.18;
  const rotRad = liftDeg * Math.PI / 180;
  const kneeX = HIP_X - L_THIGH * Math.sin(rotRad);
  const kneeY = HIP_Y + L_THIGH * Math.cos(rotRad);
  const ankleX = kneeX - L_SHIN;
  const ankleY = kneeY + L_SHIN * 0.3;

  const lm: PoseLandmarks = Array.from({ length: 33 }, () => ({
    x: 0.5, y: 0.5, z: 0, visibility: 0.1,
  })) as unknown as PoseLandmarks;
  lm[11] = { x: SHOULDER_X, y: SHOULDER_Y, z: 0, visibility: vis };
  lm[12] = { x: SHOULDER_X, y: SHOULDER_Y + 0.01, z: 0, visibility: vis * 0.7 };
  lm[23] = { x: HIP_X, y: HIP_Y, z: 0, visibility: vis };
  lm[24] = { x: HIP_X, y: HIP_Y + 0.01, z: 0, visibility: vis * 0.7 };
  lm[25] = { x: kneeX, y: kneeY, z: 0, visibility: vis };
  lm[26] = { x: HIP_X, y: HIP_Y + L_THIGH, z: 0, visibility: vis * 0.6 };
  lm[27] = { x: ankleX, y: ankleY, z: 0, visibility: vis };
  lm[28] = { x: HIP_X - L_SHIN, y: HIP_Y + L_THIGH + L_SHIN*0.3, z: 0, visibility: vis * 0.6 };
  lm[15] = { x: SHOULDER_X + 0.12, y: SHOULDER_Y + 0.32, z: 0, visibility: vis };
  lm[16] = { x: SHOULDER_X - 0.23, y: SHOULDER_Y + 0.32, z: 0, visibility: vis * 0.7 };
  return lm;
}

// ---------------------------------------------------------------------------
// Local runner
// ---------------------------------------------------------------------------
interface RunResult {
  completedReps: Array<{ depthDeg: number; mqs: number }>;
  warnings: Array<{ type: WarningType; atMs: number }>;
  finalCalibration: CalibrationUpdate | null;
  calibrationConfirmedAtMs: number | null;
}

function runDKLocal(frames: Frame[]): RunResult {
  const completedReps: Array<{ depthDeg: number; mqs: number }> = [];
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
    onRepComplete: (r) => completedReps.push({ depthDeg: r.depthDeg, mqs: r.mqs }),
    onPostureWarning: (type) => warnings.push({ type, atMs: currentTMs }),
  });

  for (const frame of frames) {
    currentTMs = frame.tMs;
    engine.update(frame.landmarks, frame.tMs);
  }
  engine.finish();

  return { completedReps, warnings, finalCalibration, calibrationConfirmedAtMs };
}

function countWarnings(result: RunResult, type: WarningType): number {
  return result.warnings.filter((w) => w.type === type).length;
}

function warningsOtherThan(result: RunResult, ...excludes: WarningType[]): Array<{ type: WarningType; atMs: number }> {
  return result.warnings.filter((w) => !excludes.includes(w.type));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('Donkey Kick — posture warnings (Fix A gating)', () => {
  it('(a) no warnings fire during AT_REST state (idle period after calibration)', () => {
    // After calibration, stay at rest for 3s (under not-moving 5s threshold)
    const TOTAL_MS = CAL_MS + 3000;
    const frames: Frame[] = [];

    for (let t = 0; t < TOTAL_MS; t += DT) {
      frames.push({ landmarks: buildDKPose(0), tMs: t });
    }

    const result = runDKLocal(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    // No warnings should fire (3s < 5s not-moving threshold)
    expect(result.warnings.length).toBe(0);
  });

  it('(b) no continuous per-frame form warnings in donkey kick v1', () => {
    // Full rep cycle: calibrate → one kick → rest. Only 'incomplete-donkey-kick'
    // or 'malformed-rep' can fire, but NOT every frame for form issues.
    // With a valid kick, NO form warnings should ever emit.
    const TOTAL_MS = CAL_MS + 4000;
    const frames: Frame[] = [];

    for (let t = 0; t < TOTAL_MS; t += DT) {
      let lm: PoseLandmarks;
      if (t < CAL_MS) {
        lm = buildDKPose(0);
      } else {
        const tInRep = t - CAL_MS;
        let deg: number;
        if (tInRep < 800) deg = (tInRep / 800) * 65;
        else if (tInRep < 1400) deg = 65;
        else if (tInRep < 2200) deg = 65 - ((tInRep - 1400) / 800) * 65;
        else deg = 0;
        lm = buildDKPose(Math.max(0, deg));
      }
      frames.push({ landmarks: lm, tMs: t });
    }

    const result = runDKLocal(frames);
    expect(result.completedReps.length).toBeGreaterThanOrEqual(1);
    // After a valid rep + short rest (< 5s), no posture warnings should exist
    expect(warningsOtherThan(result, 'not-moving').length).toBe(0);
  });

  it('no per-frame form warnings accumulate over multiple reps', () => {
    // 3 clean reps — should have zero form warnings total
    const CAL_PHASE = 2200;
    const REP_MS = 3000;
    const TOTAL_MS = CAL_PHASE + 3 * REP_MS;
    const frames: Frame[] = [];

    for (let t = 0; t < TOTAL_MS; t += DT) {
      let lm: PoseLandmarks;
      if (t < CAL_PHASE) {
        lm = buildDKPose(0);
      } else {
        const tInRep = (t - CAL_PHASE) % REP_MS;
        let deg: number;
        if (tInRep < 800) deg = (tInRep / 800) * 65;
        else if (tInRep < 1400) deg = 65;
        else if (tInRep < 2200) deg = 65 - ((tInRep - 1400) / 800) * 65;
        else deg = 0;
        lm = buildDKPose(Math.max(0, deg));
      }
      frames.push({ landmarks: lm, tMs: t });
    }

    const result = runDKLocal(frames);
    expect(result.completedReps.length).toBeGreaterThanOrEqual(3);
    expect(countWarnings(result, 'incomplete-donkey-kick' as WarningType)).toBe(0);
  });
});
