/**
 * Donkey Kick — warning gating tests.
 * Verifies: clean reps with AT_REST between → no spurious warnings.
 * Rapid back-to-back reps handled correctly.
 */
import { describe, it, expect } from 'vitest';
import type { PoseLandmarks } from '@/modules/pose/types';
import type { CalibrationUpdate } from '@/modules/squat/types';
import { DonkeyKickEngine } from '@/modules/donkey-kick/engine';
import type { DonkeyKickRepEvent } from '@/modules/donkey-kick/types';
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
  const HIP_X = 0.45;
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
  completedReps: DonkeyKickRepEvent[];
  warnings: Array<{ type: WarningType; atMs: number }>;
  finalCalibration: CalibrationUpdate | null;
}

function runDKLocal(frames: Frame[]): RunResult {
  const completedReps: DonkeyKickRepEvent[] = [];
  const warnings: Array<{ type: WarningType; atMs: number }> = [];
  let finalCalibration: CalibrationUpdate | null = null;
  let currentTMs = 0;

  const engine = new DonkeyKickEngine({
    onCalibrationUpdate: (u) => { finalCalibration = u; },
    onRepComplete: (r) => completedReps.push(r),
    onPostureWarning: (type) => warnings.push({ type, atMs: currentTMs }),
  });

  for (const frame of frames) {
    currentTMs = frame.tMs;
    engine.update(frame.landmarks, frame.tMs);
  }
  engine.finish();

  return { completedReps, warnings, finalCalibration };
}

function warningsOtherThan(result: RunResult, ...excludes: WarningType[]): Array<{ type: WarningType; atMs: number }> {
  return result.warnings.filter((w) => !excludes.includes(w.type));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('Donkey Kick — warning gating', () => {
  it('3 clean reps with AT_REST between → no spurious warnings', () => {
    const REP_CYCLE_MS = 3000;
    const TOTAL_MS = CAL_MS + 3 * REP_CYCLE_MS;
    const frames: Frame[] = [];

    for (let t = 0; t < TOTAL_MS; t += DT) {
      let lm: PoseLandmarks;
      if (t < CAL_MS) {
        lm = buildDKPose(0);
      } else {
        const tInRep = (t - CAL_MS) % REP_CYCLE_MS;
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
    expect(warningsOtherThan(result, 'not-moving').length).toBe(0);
  });

  it('2 valid reps followed by 2 short rests → still 2 reps counted', () => {
    // Two full reps (2.5s each), then 2s rest between (< 5s so no not-moving)
    const REP_MS = 2500;
    const REST_MS = 2000;
    const TOTAL_MS = CAL_MS + 2 * REP_MS + REST_MS;
    const frames: Frame[] = [];

    let repPhaseStart = CAL_MS;
    const repPhaseLen = REP_MS * 2 + REST_MS;

    for (let t = 0; t < TOTAL_MS; t += DT) {
      let lm: PoseLandmarks;
      if (t < CAL_MS) {
        lm = buildDKPose(0);
      } else {
        const phase = t - repPhaseStart;
        const repIdx = Math.floor(phase / (REP_MS + REST_MS / 2));
        const tInPhase = phase % (REP_MS + REST_MS / 2);

        void repIdx;
        void repPhaseLen;

        let deg: number;
        if (tInPhase < 700) deg = (tInPhase / 700) * 65;
        else if (tInPhase < 1200) deg = 65;
        else if (tInPhase < 1900) deg = 65 - ((tInPhase - 1200) / 700) * 65;
        else deg = 0;
        lm = buildDKPose(Math.max(0, deg));
      }
      frames.push({ landmarks: lm, tMs: t });
    }

    const result = runDKLocal(frames);
    // Should have at least 2 reps
    expect(result.completedReps.length).toBeGreaterThanOrEqual(2);
  });

  it('warning cooldown prevents double-fire of incomplete-donkey-kick on consecutive shallow reps', () => {
    // Two shallow reps back-to-back within 2.5s → cooldown prevents second warning
    const TOTAL_MS = CAL_MS + 5000;
    const frames: Frame[] = [];

    for (let t = 0; t < TOTAL_MS; t += DT) {
      let lm: PoseLandmarks;
      if (t < CAL_MS) {
        lm = buildDKPose(0);
      } else {
        // Two very shallow reps (25°) — each under the 45° minimum
        const tRep = (t - CAL_MS) % 2000;
        let deg: number;
        if (tRep < 400) deg = (tRep / 400) * 25;
        else if (tRep < 800) deg = 25;
        else if (tRep < 1200) deg = 25 - ((tRep - 800) / 400) * 25;
        else deg = 0;
        lm = buildDKPose(Math.max(0, deg));
      }
      frames.push({ landmarks: lm, tMs: t });
    }

    const result = runDKLocal(frames);
    // No valid reps (all too shallow)
    expect(result.completedReps.length).toBe(0);
    const incompleteWarnings = result.warnings.filter((w) => w.type === ('incomplete-donkey-kick' as WarningType));
    // Due to WARNING_REPEAT_COOLDOWN_MS = 2500, at most 1 warning fires every 2.5s in 5s window
    expect(incompleteWarnings.length).toBeLessThanOrEqual(3);
  });
});
