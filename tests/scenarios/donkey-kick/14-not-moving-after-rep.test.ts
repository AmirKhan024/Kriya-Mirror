/**
 * Regression test for Donkey Kick Fix O — EMA-decay reseed.
 *
 * Bug: after completing a rep, the post-rep EMA-decay tail (smoothedThighLiftDeg
 * drifting from ~20° back to 0° over several seconds) permanently inflates the
 * min-max variance window, so 'not-moving' never fires during the idle period.
 *
 * Fix: once the EMA has settled (per-frame Δ < 0.3° for 500ms), drop the
 * cached min/max and reseed from the current value.
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('Donkey Kick — regression: not-moving fires after a real rep + idle (Fix O)', () => {
  const FULL_EXT_DEG = 65;

  it('DOES fire not-moving when user rests in AT_REST after completing a rep', () => {
    // Profile: calibrate → one full kick (0 → 65° → 0 over 2.5s) → 8s idle
    // Total = 2.2 + 2.5 + 8 = 12.7s
    const REP_END_MS = CAL_MS + 2500;
    const TOTAL_MS = REP_END_MS + 8000;

    const frames: Frame[] = [];

    for (let t = 0; t < TOTAL_MS; t += DT) {
      let lm: PoseLandmarks;
      if (t < CAL_MS) {
        lm = buildDKPose(0); // calibration
      } else if (t < REP_END_MS) {
        // Real kick: 0 → peak over 1s, hold 0.5s, return over 1s
        const tInRep = t - CAL_MS;
        let deg: number;
        if (tInRep < 1000) deg = (tInRep / 1000) * FULL_EXT_DEG;
        else if (tInRep < 1500) deg = FULL_EXT_DEG;
        else deg = FULL_EXT_DEG - ((tInRep - 1500) / 1000) * FULL_EXT_DEG;
        lm = buildDKPose(Math.max(0, deg));
      } else {
        lm = buildDKPose(0); // post-rep idle
      }
      frames.push({ landmarks: lm, tMs: t });
    }

    const result = runDKLocal(frames);

    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(result.calibrationConfirmedAtMs).toBeLessThan(500);
    // Must have counted a rep
    expect(result.completedReps.length).toBeGreaterThanOrEqual(1);
    // The whole point: not-moving must fire post-rep
    expect(countWarnings(result, 'not-moving')).toBeGreaterThanOrEqual(1);
  });

  it('not-moving does NOT fire when user rests only 3s after a rep (under 5s threshold)', () => {
    // Rep completes, then short rest (3s) — should NOT fire not-moving yet
    const REP_END_MS = CAL_MS + 2500;
    const TOTAL_MS = REP_END_MS + 3000; // only 3s idle — under 5s threshold

    const frames: Frame[] = [];

    for (let t = 0; t < TOTAL_MS; t += DT) {
      let lm: PoseLandmarks;
      if (t < CAL_MS) {
        lm = buildDKPose(0);
      } else if (t < REP_END_MS) {
        const tInRep = t - CAL_MS;
        let deg: number;
        if (tInRep < 1000) deg = (tInRep / 1000) * FULL_EXT_DEG;
        else if (tInRep < 1500) deg = FULL_EXT_DEG;
        else deg = FULL_EXT_DEG - ((tInRep - 1500) / 1000) * FULL_EXT_DEG;
        lm = buildDKPose(Math.max(0, deg));
      } else {
        lm = buildDKPose(0);
      }
      frames.push({ landmarks: lm, tMs: t });
    }

    const result = runDKLocal(frames);
    // Only 3s of idle after rep — should NOT fire not-moving (5s threshold)
    expect(countWarnings(result, 'not-moving')).toBe(0);
  });
});
