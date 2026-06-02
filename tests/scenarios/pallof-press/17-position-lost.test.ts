/**
 * Pallof Press — position-lost warning (Fix N).
 *
 * Mirrors tests/scenarios/bird-dog/17-position-lost.test.ts.
 *
 * Spec: if no usable pose frame (landmarks null OR core body landmarks not
 * visible) for ≥ 3 seconds post-calibration, the engine emits 'position-lost'.
 * Repeats at most every 10s while the pose is still absent.
 */
import { describe, it, expect } from 'vitest';
import type { PoseLandmarks } from '@/modules/pose/types';
import type { CalibrationUpdate } from '@/modules/squat/types';
import type { WarningType } from '@/store/workout';
import { PallofPressEngine } from '@/modules/pallof-press/engine';
import type { PallofPressFrameMetrics } from '@/modules/pallof-press/types';

// ---------------------------------------------------------------------------
// Pose builder — valid calibration-ready pose
// ---------------------------------------------------------------------------
const VIS = 0.95;
const N = 33;
function makeL(x: number, y: number, vis = VIS) { return { x, y, z: 0, visibility: vis }; }
function emptyPose(): PoseLandmarks {
  return new Array(N).fill(null).map(() => makeL(0.5, 0.5, 0.1)) as unknown as PoseLandmarks;
}

function buildValidPose(): PoseLandmarks {
  const p = emptyPose();
  const midX = 0.50;
  const shoulderY = 0.28;
  const hipY = 0.52;
  const ankleY = 0.88;
  const shoulderHalfW = 0.12;
  const hipHalfW = 0.09;
  const noseY = 0.12;

  p[0]  = makeL(midX, noseY);
  p[11] = makeL(midX - shoulderHalfW, shoulderY);
  p[12] = makeL(midX + shoulderHalfW, shoulderY);
  p[23] = makeL(midX - hipHalfW, hipY);
  p[24] = makeL(midX + hipHalfW, hipY);
  p[25] = makeL(midX - hipHalfW, hipY + 0.15);
  p[26] = makeL(midX + hipHalfW, hipY + 0.15);
  p[27] = makeL(midX - hipHalfW, ankleY);
  p[28] = makeL(midX + hipHalfW, ankleY);

  const elbowY = shoulderY + 0.12;
  const wristY = elbowY + 0.10; // arms at chest

  p[13] = makeL(midX - shoulderHalfW, elbowY);
  p[14] = makeL(midX + shoulderHalfW, elbowY);
  p[15] = makeL(midX - shoulderHalfW, wristY);
  p[16] = makeL(midX + shoulderHalfW, wristY);

  return p;
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------
interface RunResult {
  warnings: Array<{ type: WarningType; atMs: number }>;
  finalCalibration: CalibrationUpdate | null;
  calibrationConfirmedAtMs: number | null;
}

function runLocal(frames: Array<{ landmarks: PoseLandmarks | null; tMs: number }>): RunResult {
  const warnings: Array<{ type: WarningType; atMs: number }> = [];
  let finalCalibration: CalibrationUpdate | null = null;
  let calibrationConfirmedAtMs: number | null = null;
  let currentTMs = 0;

  const engine = new PallofPressEngine({
    onCalibrationUpdate: (u: CalibrationUpdate) => {
      finalCalibration = u;
      if (u.state === 'confirmed' && calibrationConfirmedAtMs === null) {
        calibrationConfirmedAtMs = currentTMs;
      }
    },
    onRepComplete: () => {},
    onHoldTick: () => {},
    onPostureWarning: (type: WarningType) => warnings.push({ type, atMs: currentTMs }),
    onFrame: (_: PallofPressFrameMetrics) => {},
  });

  for (const frame of frames) {
    currentTMs = frame.tMs;
    engine.update(frame.landmarks, frame.tMs);
  }
  engine.finish();

  return { warnings, finalCalibration, calibrationConfirmedAtMs };
}

function countWarnings(result: RunResult, type: WarningType): number {
  return result.warnings.filter(w => w.type === type).length;
}

// ---------------------------------------------------------------------------
// Frame builders
// ---------------------------------------------------------------------------
const FPS = 30;
const DT = 1000 / FPS;
const CAL_MS = 2000;

function buildCalibrationFrames(): Array<{ landmarks: PoseLandmarks; tMs: number }> {
  const frames = [];
  for (let t = 0; t < CAL_MS; t += DT) {
    frames.push({ landmarks: buildValidPose(), tMs: t });
  }
  return frames;
}

function buildNullFrames(startMs: number, durationMs: number): Array<{ landmarks: null; tMs: number }> {
  const frames = [];
  for (let t = 0; t < durationMs; t += DT) {
    frames.push({ landmarks: null, tMs: startMs + t });
  }
  return frames;
}

function buildValidFrames(startMs: number, durationMs: number): Array<{ landmarks: PoseLandmarks; tMs: number }> {
  const frames = [];
  for (let t = 0; t < durationMs; t += DT) {
    frames.push({ landmarks: buildValidPose(), tMs: startMs + t });
  }
  return frames;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('Pallof Press — position-lost warning (Fix N)', () => {
  it('fires position-lost after 3+ seconds of null landmarks post-calibration', () => {
    const calFrames = buildCalibrationFrames();
    const nullFrames = buildNullFrames(CAL_MS, 4000); // 4s of null post-cal

    const result = runLocal([...calFrames, ...nullFrames]);
    expect(result.finalCalibration?.state).toBe('confirmed');
    expect(countWarnings(result, 'position-lost')).toBeGreaterThan(0);
  });

  it('does NOT fire position-lost on a clean continuous stream', () => {
    const frames = buildValidFrames(0, 5000);
    // No calibration → no position-lost (position-lost only fires post-calibration)
    const result = runLocal(frames);
    expect(countWarnings(result, 'position-lost')).toBe(0);
  });

  it('does NOT fire position-lost during the calibration phase (before confirm)', () => {
    // Null frames during calibration → position-lost must NOT fire
    const nullDuringCal: Array<{ landmarks: null; tMs: number }> = [];
    for (let t = 0; t < 1500; t += DT) {
      nullDuringCal.push({ landmarks: null, tMs: t });
    }
    // Come into frame at 1.5s; calibration proceeds from here
    const calAfter = buildValidFrames(1500, 2500);

    const result = runLocal([...nullDuringCal, ...calAfter]);
    expect(countWarnings(result, 'position-lost')).toBe(0);
  });

  it('does NOT re-fire position-lost within the 10s cooldown', () => {
    // 5s of null post-cal — should fire exactly once (at the 3s mark)
    const calFrames = buildCalibrationFrames();
    const nullFrames = buildNullFrames(CAL_MS, 5000);

    const result = runLocal([...calFrames, ...nullFrames]);
    expect(countWarnings(result, 'position-lost')).toBe(1);
  });

  it('fires again after 10s cooldown has elapsed', () => {
    // 15s of null post-cal — should fire twice (at ~3s and ~13s)
    const calFrames = buildCalibrationFrames();
    const nullFrames = buildNullFrames(CAL_MS, 15000);

    const result = runLocal([...calFrames, ...nullFrames]);
    expect(countWarnings(result, 'position-lost')).toBeGreaterThanOrEqual(2);
  });

  it('stops firing position-lost when valid landmarks resume', () => {
    // 4s null → 3s valid → total should be exactly 1 position-lost
    const calFrames = buildCalibrationFrames();
    const nullFrames = buildNullFrames(CAL_MS, 4000);
    const resumeFrames = buildValidFrames(CAL_MS + 4000, 3000);

    const result = runLocal([...calFrames, ...nullFrames, ...resumeFrames]);
    expect(countWarnings(result, 'position-lost')).toBe(1);
  });
});
