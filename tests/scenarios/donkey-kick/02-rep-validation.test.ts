/**
 * Donkey Kick — rep validation tests.
 * (a) peak thighLiftDeg < 45° → 'incomplete-donkey-kick' fires + rep rejected
 * (b) kick duration < 500ms → 'malformed-rep' fires
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
// Pose builder (side camera, at-rest quadruped with body horizontal)
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
  const wristY = SHOULDER_Y + 0.32;

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
  lm[15] = { x: SHOULDER_X + 0.12, y: wristY, z: 0, visibility: vis };
  lm[16] = { x: SHOULDER_X - 0.23, y: wristY, z: 0, visibility: vis * 0.7 };
  return lm;
}

// ---------------------------------------------------------------------------
// Local runner
// ---------------------------------------------------------------------------
interface RunResult {
  completedReps: DonkeyKickRepEvent[];
  warnings: Array<{ type: WarningType; atMs: number }>;
  finalCalibration: CalibrationUpdate | null;
  calibrationConfirmedAtMs: number | null;
}

function runDKLocal(frames: Frame[]): RunResult {
  const completedReps: DonkeyKickRepEvent[] = [];
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
    onRepComplete: (r) => completedReps.push(r),
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
describe('Donkey Kick — rep validation', () => {
  it('(a) too-shallow kick (peak < 45°) → incomplete-donkey-kick fires + rep rejected', () => {
    // Calibrate, then do a shallow kick: 0 → 30° → 0 over 2s
    const TOTAL_MS = CAL_MS + 4000;
    const frames: Frame[] = [];

    for (let t = 0; t < TOTAL_MS; t += DT) {
      let lm: PoseLandmarks;
      if (t < CAL_MS) {
        lm = buildDKPose(0);
      } else {
        const tInRep = t - CAL_MS;
        let deg: number;
        if (tInRep < 700) {
          deg = (tInRep / 700) * 30; // rise to 30° (< 45° min depth)
        } else if (tInRep < 1200) {
          deg = 30;
        } else if (tInRep < 1900) {
          deg = 30 - ((tInRep - 1200) / 700) * 30;
        } else {
          deg = 0;
        }
        lm = buildDKPose(Math.max(0, deg));
      }
      frames.push({ landmarks: lm, tMs: t });
    }

    const result = runDKLocal(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    // Rep should be REJECTED (incomplete kick)
    expect(result.completedReps.length).toBe(0);
    // Warning should fire
    expect(countWarnings(result, 'incomplete-donkey-kick' as WarningType)).toBeGreaterThanOrEqual(1);
  });

  it('(b) kick < 500ms → malformed-rep fires', () => {
    // Profile: jump immediately to full extension (65°), hold 250ms so EMA
    // rises above 45° MIN_REP_DEPTH, then return instantly. Total < 500ms.
    // This ensures too-fast check fires (peak >= 45°, duration < 500ms).
    const TOTAL_MS = CAL_MS + 3000;
    const frames: Frame[] = [];
    const HOLD_MS = 250;  // hold at peak so EMA can catch up to 45°+
    const RETURN_MS = 50; // fast return
    const FAST_CYCLE_MS = HOLD_MS + RETURN_MS; // 300ms total < 500ms

    for (let t = 0; t < TOTAL_MS; t += DT) {
      let lm: PoseLandmarks;
      if (t < CAL_MS) {
        lm = buildDKPose(0);
      } else {
        const tInRep = t - CAL_MS;
        let deg: number;
        if (tInRep < HOLD_MS) {
          // Hold at full extension so EMA catches up
          deg = 65;
        } else if (tInRep < FAST_CYCLE_MS) {
          // Very fast return
          deg = 65 - ((tInRep - HOLD_MS) / RETURN_MS) * 65;
        } else {
          deg = 0;
        }
        lm = buildDKPose(Math.max(0, deg));
      }
      frames.push({ landmarks: lm, tMs: t });
    }

    const result = runDKLocal(frames);
    expect(result.finalCalibration?.state).toBe('confirmed');
    // Rep should be REJECTED (too fast)
    expect(result.completedReps.length).toBe(0);
    // malformed-rep warning should fire (not incomplete-donkey-kick — peak EMA reaches 45°+)
    expect(countWarnings(result, 'malformed-rep')).toBeGreaterThanOrEqual(1);
  });

  it('clean 65° kick over 2s → valid rep counted, no validation warnings', () => {
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
    expect(countWarnings(result, 'incomplete-donkey-kick' as WarningType)).toBe(0);
    expect(countWarnings(result, 'malformed-rep')).toBe(0);
  });
});
