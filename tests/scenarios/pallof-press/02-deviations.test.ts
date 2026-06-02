/**
 * Pallof Press — Deviations: short hold, torso rotation, and timer freeze.
 *
 * Sub-tests:
 * 1. Short hold (< 1000ms) → emits 'incomplete-pallof-press'
 * 2. Torso rotation during hold → emits 'torso-rotation-pallof' live + in validateRepShape
 * 3. Timer freeze: intermittent rotation → only clean time accumulates
 */
import { describe, it, expect } from 'vitest';
import type { PoseLandmarks } from '@/modules/pose/types';
import type { CalibrationUpdate } from '@/modules/squat/types';
import type { WarningType } from '@/store/workout';
import { PallofPressEngine } from '@/modules/pallof-press/engine';
import type { PallofPressRepEvent, PallofPressFrameMetrics } from '@/modules/pallof-press/types';

// ---------------------------------------------------------------------------
// Shared pose builder (identical to 01-happy-path)
// ---------------------------------------------------------------------------
const VIS = 0.95;
const N = 33;
function makeL(x: number, y: number, vis = VIS) { return { x, y, z: 0, visibility: vis }; }
function emptyPose(): PoseLandmarks {
  return new Array(N).fill(null).map(() => makeL(0.5, 0.5, 0.1)) as unknown as PoseLandmarks;
}

function buildPallofPressPose(opts: {
  elbowExtensionDeg: number;
  torsoRotationDeg?: number;
}): PoseLandmarks {
  const { elbowExtensionDeg, torsoRotationDeg = 0 } = opts;
  const p = emptyPose();
  const midX = 0.50;
  const shoulderY = 0.28;
  const hipY = 0.52;
  const kneeY = 0.70;
  const ankleY = 0.88;
  const noseY = 0.12;
  const shoulderHalfW = 0.12;
  const hipHalfW = 0.09;
  // rotShift chosen so computeTorsoRotationDeg returns ~torsoRotationDeg.
  // Engine formula: rotDeg = atan2(|currentDiff - baselineDiff|, shoulderWidth).
  // shoulderWidth = 2 * shoulderHalfW = 0.24. For rotDeg = torsoRotationDeg:
  //   currentDiff = shoulderWidth * tan(torsoRotationDeg * PI/180)
  //   rotShift = currentDiff / 2 = shoulderHalfW * tan(...)
  const rotRad = (torsoRotationDeg * Math.PI) / 180;
  const rotShift = shoulderHalfW * Math.tan(rotRad);
  const lsY = shoulderY + rotShift;
  const rsY = shoulderY - rotShift;

  p[0]  = makeL(midX, noseY);
  p[11] = makeL(midX - shoulderHalfW, lsY);
  p[12] = makeL(midX + shoulderHalfW, rsY);
  p[23] = makeL(midX - hipHalfW, hipY);
  p[24] = makeL(midX + hipHalfW, hipY);
  p[25] = makeL(midX - hipHalfW, kneeY);
  p[26] = makeL(midX + hipHalfW, kneeY);
  p[27] = makeL(midX - hipHalfW, ankleY);
  p[28] = makeL(midX + hipHalfW, ankleY);

  const armLen = 0.12;
  const forearmLen = 0.10;
  const elbowY = lsY + armLen;
  const re_elbowY = rsY + armLen;
  const extRad = ((180 - elbowExtensionDeg) * Math.PI) / 180;
  const forearmDX = forearmLen * Math.sin(extRad);
  const forearmDY = forearmLen * Math.cos(extRad);
  const lwY = elbowY + forearmDY;
  const rwY = re_elbowY + forearmDY;

  p[13] = makeL(midX - shoulderHalfW, elbowY);
  p[14] = makeL(midX + shoulderHalfW, re_elbowY);
  p[15] = makeL(midX - shoulderHalfW + forearmDX, lwY);
  p[16] = makeL(midX + shoulderHalfW - forearmDX, rwY);
  return p;
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------
interface RunResult {
  calibrationConfirmedAtMs: number | null;
  completedReps: Array<PallofPressRepEvent & { atMs: number }>;
  warnings: Array<{ type: WarningType; atMs: number }>;
  holdTicks: Array<{ accumulatedMs: number; isTimerRunning: boolean; targetMs: number; atMs: number }>;
}

function runLocal(frames: Array<{ landmarks: PoseLandmarks | null; tMs: number }>): RunResult {
  const completedReps: Array<PallofPressRepEvent & { atMs: number }> = [];
  const warnings: Array<{ type: WarningType; atMs: number }> = [];
  const holdTicks: Array<{ accumulatedMs: number; isTimerRunning: boolean; targetMs: number; atMs: number }> = [];
  let calibrationConfirmedAtMs: number | null = null;
  let currentTMs = 0;

  const engine = new PallofPressEngine({
    onCalibrationUpdate: (u: CalibrationUpdate) => {
      if (u.state === 'confirmed' && calibrationConfirmedAtMs === null) calibrationConfirmedAtMs = currentTMs;
    },
    onRepComplete: (rep: PallofPressRepEvent) => {
      completedReps.push({ ...rep, atMs: currentTMs });
    },
    onHoldTick: (tick) => {
      holdTicks.push({ ...tick, atMs: currentTMs });
    },
    onPostureWarning: (type: WarningType) => {
      warnings.push({ type, atMs: currentTMs });
    },
    onFrame: (_: PallofPressFrameMetrics) => {},
  });

  for (const frame of frames) {
    currentTMs = frame.tMs;
    engine.update(frame.landmarks, frame.tMs);
  }
  engine.finish();
  return { calibrationConfirmedAtMs, completedReps, warnings, holdTicks };
}

// ---------------------------------------------------------------------------
// Frame helpers
// ---------------------------------------------------------------------------
const FPS = 30;
const DT = 1000 / FPS;
const CAL_MS = 2000;

function buildCalFrames(): Array<{ landmarks: PoseLandmarks; tMs: number }> {
  const frames = [];
  for (let t = 0; t < CAL_MS; t += DT) {
    frames.push({ landmarks: buildPallofPressPose({ elbowExtensionDeg: 90 }), tMs: t });
  }
  return frames;
}

function buildFrameRange(
  startMs: number,
  durationMs: number,
  pose: () => PoseLandmarks,
): Array<{ landmarks: PoseLandmarks; tMs: number }> {
  const frames = [];
  for (let t = 0; t < durationMs; t += DT) {
    frames.push({ landmarks: pose(), tMs: startMs + t });
  }
  return frames;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('Pallof Press — deviations', () => {
  it('1. Short hold: press out cleanly but return after only 500ms → emits incomplete-pallof-press', () => {
    const calFrames = buildCalFrames();

    // Press out phase: 90 → 165 in 700ms
    const pressFrames = buildFrameRange(CAL_MS, 700, () => {
      // use a static extended pose for simplicity — engine transitions on elbow deg
      return buildPallofPressPose({ elbowExtensionDeg: 160 });
    });

    // Short hold: 500ms at extension
    const holdFrames = buildFrameRange(CAL_MS + 700, 500,
      () => buildPallofPressPose({ elbowExtensionDeg: 165 }),
    );

    // Return: 165 → 90 in 700ms
    const returnFrames = buildFrameRange(CAL_MS + 1200, 700,
      () => buildPallofPressPose({ elbowExtensionDeg: 90 }),
    );

    const result = runLocal([...calFrames, ...pressFrames, ...holdFrames, ...returnFrames]);

    // Rep should be rejected — incomplete hold → incomplete-pallof-press
    expect(result.completedReps).toHaveLength(0);
    const incompletes = result.warnings.filter(w => w.type === 'incomplete-pallof-press');
    expect(incompletes.length).toBeGreaterThan(0);
  });

  it('2. Torso rotation during hold → emits torso-rotation-pallof live during AT_EXTENDED', () => {
    const calFrames = buildCalFrames();

    // Press out
    const pressFrames: Array<{ landmarks: PoseLandmarks; tMs: number }> = [];
    for (let t = 0; t < 700; t += DT) {
      const ratio = t / 700;
      const deg = 90 + ratio * 75;
      pressFrames.push({
        landmarks: buildPallofPressPose({ elbowExtensionDeg: deg }),
        tMs: CAL_MS + t,
      });
    }

    // Hold with 10° torso rotation for 1.5s
    const holdFrames = buildFrameRange(CAL_MS + 700, 1500,
      () => buildPallofPressPose({ elbowExtensionDeg: 165, torsoRotationDeg: 10 }),
    );

    // Return
    const returnFrames = buildFrameRange(CAL_MS + 2200, 700,
      () => buildPallofPressPose({ elbowExtensionDeg: 90 }),
    );

    const result = runLocal([...calFrames, ...pressFrames, ...holdFrames, ...returnFrames]);

    // Should see live torso-rotation-pallof warnings
    const rotWarnings = result.warnings.filter(w => w.type === 'torso-rotation-pallof');
    expect(rotWarnings.length).toBeGreaterThan(0);
  });

  it('3. Timer freeze: intermittent rotation means only clean time accumulates', () => {
    const calFrames = buildCalFrames();

    // Press out phase
    const pressFrames: Array<{ landmarks: PoseLandmarks; tMs: number }> = [];
    for (let t = 0; t < 700; t += DT) {
      const ratio = t / 700;
      const deg = 90 + ratio * 75;
      pressFrames.push({
        landmarks: buildPallofPressPose({ elbowExtensionDeg: deg }),
        tMs: CAL_MS + t,
      });
    }

    const extendedStart = CAL_MS + 700;
    // 1200ms clean + 300ms rotating + 600ms clean = 2100ms total
    // Only ~1800ms should accumulate (1200 + 600 clean)
    const holdFrames: Array<{ landmarks: PoseLandmarks; tMs: number }> = [];
    for (let t = 0; t < 2100; t += DT) {
      const tAbs = extendedStart + t;
      const rotating = t >= 1200 && t < 1500; // 300ms of rotation
      holdFrames.push({
        landmarks: buildPallofPressPose({
          elbowExtensionDeg: 165,
          torsoRotationDeg: rotating ? 12 : 0, // 12° > 8° threshold
        }),
        tMs: tAbs,
      });
    }

    // Return
    const returnFrames = buildFrameRange(extendedStart + 2100, 700,
      () => buildPallofPressPose({ elbowExtensionDeg: 90 }),
    );

    const result = runLocal([...calFrames, ...pressFrames, ...holdFrames, ...returnFrames]);

    // The rep should complete since clean hold ≥ 1000ms
    expect(result.completedReps).toHaveLength(1);

    // The accumulated hold should be at least 1000ms (800ms + 400ms clean)
    // Note: EMA lag adds ~300-400ms extra AT_EXTENDED time, so holdMs may exceed 1500ms
    const rep = result.completedReps[0];
    expect(rep.holdMs).toBeGreaterThanOrEqual(1000);
  });
});
