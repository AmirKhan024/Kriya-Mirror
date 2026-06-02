/**
 * Pallof Press — Posture warnings: shoulder shrug and Fix A gating.
 *
 * Sub-tests:
 * 1. Shoulder shrug during press → emits 'shoulder-shrug'
 * 2. Shoulder shrug at HANDS_AT_CHEST does NOT fire (Fix A: only when state ≠ HANDS_AT_CHEST)
 */
import { describe, it, expect } from 'vitest';
import type { PoseLandmarks } from '@/modules/pose/types';
import type { CalibrationUpdate } from '@/modules/squat/types';
import type { WarningType } from '@/store/workout';
import { PallofPressEngine } from '@/modules/pallof-press/engine';
import type { PallofPressRepEvent, PallofPressFrameMetrics } from '@/modules/pallof-press/types';

// ---------------------------------------------------------------------------
// Pose builder — front camera with optional shoulder shrug
// ---------------------------------------------------------------------------
const VIS = 0.95;
const N = 33;
function makeL(x: number, y: number, vis = VIS) { return { x, y, z: 0, visibility: vis }; }
function emptyPose(): PoseLandmarks {
  return new Array(N).fill(null).map(() => makeL(0.5, 0.5, 0.1)) as unknown as PoseLandmarks;
}

/**
 * shoulderShrugRatio: fraction of torsoHeight by which shoulders rise above baseline.
 * 0 = normal, > 0.06 = shrug detected (SHOULDER_SHRUG_THRESHOLD = 0.06).
 * We simulate shrug by lowering shoulderY (toward top of frame).
 */
function buildPallofPressPose(opts: {
  elbowExtensionDeg: number;
  shoulderShrugRatio?: number;
  isCalibrationPose?: boolean;
}): PoseLandmarks {
  const { elbowExtensionDeg, shoulderShrugRatio = 0, isCalibrationPose = false } = opts;
  const p = emptyPose();
  const midX = 0.50;

  // Baseline shoulder Y = 0.28. Torso height ≈ hipY - shoulderY = 0.52 - 0.28 = 0.24
  // shrug shifts shoulders up by (ratio * torsoHeight)
  const baseShoulderY = 0.28;
  const torsoHeight = 0.24; // hipY - shoulderY
  // If this is the calibration pose, no shrug regardless of ratio (engine captures baseline here)
  const shrugShift = isCalibrationPose ? 0 : shoulderShrugRatio * torsoHeight;
  const shoulderY = baseShoulderY - shrugShift; // smaller Y = higher = shruggers

  const hipY = 0.52;
  const kneeY = 0.70;
  const ankleY = 0.88;
  const noseY = 0.12;
  const shoulderHalfW = 0.12;
  const hipHalfW = 0.09;

  p[0]  = makeL(midX, noseY);
  p[11] = makeL(midX - shoulderHalfW, shoulderY);
  p[12] = makeL(midX + shoulderHalfW, shoulderY);
  p[23] = makeL(midX - hipHalfW, hipY);
  p[24] = makeL(midX + hipHalfW, hipY);
  p[25] = makeL(midX - hipHalfW, kneeY);
  p[26] = makeL(midX + hipHalfW, kneeY);
  p[27] = makeL(midX - hipHalfW, ankleY);
  p[28] = makeL(midX + hipHalfW, ankleY);

  const armLen = 0.12;
  const forearmLen = 0.10;
  const elbowY = shoulderY + armLen;
  const theta = ((180 - elbowExtensionDeg) * Math.PI) / 180;
  const forearmDY = forearmLen * Math.cos(theta);
  const wristY = elbowY + forearmDY;

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
  calibrationConfirmedAtMs: number | null;
  completedReps: Array<PallofPressRepEvent & { atMs: number }>;
  warnings: Array<{ type: WarningType; atMs: number }>;
}

function runLocal(frames: Array<{ landmarks: PoseLandmarks | null; tMs: number }>): RunResult {
  const completedReps: Array<PallofPressRepEvent & { atMs: number }> = [];
  const warnings: Array<{ type: WarningType; atMs: number }> = [];
  let calibrationConfirmedAtMs: number | null = null;
  let currentTMs = 0;

  const engine = new PallofPressEngine({
    onCalibrationUpdate: (u: CalibrationUpdate) => {
      if (u.state === 'confirmed' && calibrationConfirmedAtMs === null) calibrationConfirmedAtMs = currentTMs;
    },
    onRepComplete: (rep: PallofPressRepEvent) => { completedReps.push({ ...rep, atMs: currentTMs }); },
    onHoldTick: () => {},
    onPostureWarning: (type: WarningType) => { warnings.push({ type, atMs: currentTMs }); },
    onFrame: (_: PallofPressFrameMetrics) => {},
  });

  for (const frame of frames) {
    currentTMs = frame.tMs;
    engine.update(frame.landmarks, frame.tMs);
  }
  engine.finish();
  return { calibrationConfirmedAtMs, completedReps, warnings };
}

const FPS = 30;
const DT = 1000 / FPS;
const CAL_MS = 2000;

function buildCalFrames(): Array<{ landmarks: PoseLandmarks; tMs: number }> {
  const frames = [];
  for (let t = 0; t < CAL_MS; t += DT) {
    // Calibration pose: no shrug, arms at chest
    frames.push({
      landmarks: buildPallofPressPose({ elbowExtensionDeg: 90, isCalibrationPose: true }),
      tMs: t,
    });
  }
  return frames;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('Pallof Press — posture warnings', () => {
  it('1. Shoulder shrug during press/hold → emits shoulder-shrug', () => {
    const calFrames = buildCalFrames();
    const frames: Array<{ landmarks: PoseLandmarks; tMs: number }> = [];

    // Press out phase with shrug
    for (let t = 0; t < 700; t += DT) {
      const ratio = t / 700;
      const deg = 90 + ratio * 75;
      frames.push({
        landmarks: buildPallofPressPose({ elbowExtensionDeg: deg, shoulderShrugRatio: 0.10 }),
        tMs: CAL_MS + t,
      });
    }

    // Hold with shrug for 2s
    for (let t = 0; t < 2000; t += DT) {
      frames.push({
        landmarks: buildPallofPressPose({ elbowExtensionDeg: 165, shoulderShrugRatio: 0.10 }),
        tMs: CAL_MS + 700 + t,
      });
    }

    // Return
    for (let t = 0; t < 700; t += DT) {
      const ratio = t / 700;
      const deg = 165 - ratio * 75;
      frames.push({
        landmarks: buildPallofPressPose({ elbowExtensionDeg: deg }),
        tMs: CAL_MS + 2700 + t,
      });
    }

    const result = runLocal([...calFrames, ...frames]);

    const shrugWarnings = result.warnings.filter(w => w.type === 'shoulder-shrug');
    expect(shrugWarnings.length).toBeGreaterThan(0);
  });

  it('2. Shoulder shrug at HANDS_AT_CHEST state does NOT fire (Fix A)', () => {
    const calFrames = buildCalFrames();

    // Stay in HANDS_AT_CHEST (elbow < 115°) with shrug for 3s
    const frames: Array<{ landmarks: PoseLandmarks; tMs: number }> = [];
    for (let t = 0; t < 3000; t += DT) {
      frames.push({
        landmarks: buildPallofPressPose({
          elbowExtensionDeg: 90, // at chest — state = HANDS_AT_CHEST
          shoulderShrugRatio: 0.10, // shrug present
        }),
        tMs: CAL_MS + t,
      });
    }

    const result = runLocal([...calFrames, ...frames]);

    // Fix A: no warnings should fire while at HANDS_AT_CHEST
    const shrugWarnings = result.warnings.filter(w => w.type === 'shoulder-shrug');
    expect(shrugWarnings).toHaveLength(0);
  });
});
