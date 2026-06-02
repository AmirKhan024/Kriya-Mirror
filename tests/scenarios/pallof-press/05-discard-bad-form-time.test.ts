/**
 * Pallof Press — Discard bad-form time from hold counter (Fix B).
 *
 * Mirrors tests/scenarios/plank/05-discard-bad-form-time.test.ts.
 *
 * The hold timer should NOT accumulate while torsoRotationDeg > threshold (8°).
 * Timer resumes immediately when form corrects.
 *
 * "Sustained" = at least TORSO_ROTATION_DEBOUNCE_FRAMES (8) frames.
 * The EMA smoothing means transitions are not instant but within a few frames.
 */
import { describe, it, expect } from 'vitest';
import type { PoseLandmarks } from '@/modules/pose/types';
import type { CalibrationUpdate } from '@/modules/squat/types';
import type { WarningType } from '@/store/workout';
import { PallofPressEngine } from '@/modules/pallof-press/engine';
import type { PallofPressRepEvent, PallofPressFrameMetrics } from '@/modules/pallof-press/types';

// ---------------------------------------------------------------------------
// Pose builder
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
  p[13] = makeL(midX - shoulderHalfW, elbowY);
  p[14] = makeL(midX + shoulderHalfW, re_elbowY);
  p[15] = makeL(midX - shoulderHalfW + forearmDX, elbowY + forearmDY);
  p[16] = makeL(midX + shoulderHalfW - forearmDX, re_elbowY + forearmDY);
  return p;
}

// ---------------------------------------------------------------------------
// Runner — captures hold-tick data
// ---------------------------------------------------------------------------
interface RunResult {
  calibrationConfirmedAtMs: number | null;
  completedReps: Array<PallofPressRepEvent & { atMs: number }>;
  holdTicks: Array<{ accumulatedMs: number; isTimerRunning: boolean; targetMs: number; atMs: number }>;
  warnings: Array<{ type: WarningType; atMs: number }>;
}

function runLocal(frames: Array<{ landmarks: PoseLandmarks | null; tMs: number }>): RunResult {
  const completedReps: Array<PallofPressRepEvent & { atMs: number }> = [];
  const holdTicks: Array<{ accumulatedMs: number; isTimerRunning: boolean; targetMs: number; atMs: number }> = [];
  const warnings: Array<{ type: WarningType; atMs: number }> = [];
  let calibrationConfirmedAtMs: number | null = null;
  let currentTMs = 0;

  const engine = new PallofPressEngine({
    onCalibrationUpdate: (u: CalibrationUpdate) => {
      if (u.state === 'confirmed' && calibrationConfirmedAtMs === null) calibrationConfirmedAtMs = currentTMs;
    },
    onRepComplete: (rep: PallofPressRepEvent) => { completedReps.push({ ...rep, atMs: currentTMs }); },
    onHoldTick: (tick) => { holdTicks.push({ ...tick, atMs: currentTMs }); },
    onPostureWarning: (type: WarningType) => { warnings.push({ type, atMs: currentTMs }); },
    onFrame: (_: PallofPressFrameMetrics) => {},
  });

  for (const frame of frames) {
    currentTMs = frame.tMs;
    engine.update(frame.landmarks, frame.tMs);
  }
  engine.finish();
  return { calibrationConfirmedAtMs, completedReps, holdTicks, warnings };
}

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
describe('Pallof Press — discard bad-form time from hold counter (Fix B)', () => {
  it('accumulates full hold time when form is clean throughout', () => {
    const calFrames = buildCalFrames();

    // Press out (700ms)
    const pressFrames: Array<{ landmarks: PoseLandmarks; tMs: number }> = [];
    for (let t = 0; t < 700; t += DT) {
      const ratio = t / 700;
      const deg = 90 + ratio * 75;
      pressFrames.push({
        landmarks: buildPallofPressPose({ elbowExtensionDeg: deg }),
        tMs: CAL_MS + t,
      });
    }

    // Hold clean for 2000ms
    const holdFrames = buildFrameRange(
      CAL_MS + 700, 2000,
      () => buildPallofPressPose({ elbowExtensionDeg: 165, torsoRotationDeg: 0 }),
    );

    // Return (700ms)
    const returnFrames: Array<{ landmarks: PoseLandmarks; tMs: number }> = [];
    for (let t = 0; t < 700; t += DT) {
      const ratio = t / 700;
      const deg = 165 - ratio * 75;
      returnFrames.push({
        landmarks: buildPallofPressPose({ elbowExtensionDeg: deg }),
        tMs: CAL_MS + 2700 + t,
      });
    }

    const result = runLocal([...calFrames, ...pressFrames, ...holdFrames, ...returnFrames]);

    expect(result.completedReps).toHaveLength(1);
    const rep = result.completedReps[0];
    // 2000ms clean hold should accumulate ~2000ms (EMA lag adds ~200-400ms extra)
    expect(rep.holdMs).toBeGreaterThanOrEqual(1800);
    expect(rep.holdMs).toBeLessThanOrEqual(2600);
  });

  it('freezes hold counter during rotation, resumes when form corrects', () => {
    const calFrames = buildCalFrames();

    // Press out
    const pressFrames: Array<{ landmarks: PoseLandmarks; tMs: number }> = [];
    for (let t = 0; t < 700; t += DT) {
      const ratio = t / 700;
      const deg = 90 + ratio * 75;
      pressFrames.push({ landmarks: buildPallofPressPose({ elbowExtensionDeg: deg }), tMs: CAL_MS + t });
    }

    const holdStart = CAL_MS + 700;
    // 600ms clean + 500ms rotating + 600ms clean = 1700ms total
    // Only ~1200ms should accumulate
    const holdFrames: Array<{ landmarks: PoseLandmarks; tMs: number }> = [];
    for (let t = 0; t < 1700; t += DT) {
      const rotating = t >= 600 && t < 1100; // 500ms with 12° rotation
      holdFrames.push({
        landmarks: buildPallofPressPose({
          elbowExtensionDeg: 165,
          torsoRotationDeg: rotating ? 12 : 0,
        }),
        tMs: holdStart + t,
      });
    }

    // Return
    const returnFrames: Array<{ landmarks: PoseLandmarks; tMs: number }> = [];
    for (let t = 0; t < 700; t += DT) {
      const ratio = t / 700;
      const deg = 165 - ratio * 75;
      returnFrames.push({
        landmarks: buildPallofPressPose({ elbowExtensionDeg: deg }),
        tMs: holdStart + 1700 + t,
      });
    }

    const result = runLocal([...calFrames, ...pressFrames, ...holdFrames, ...returnFrames]);

    expect(result.completedReps).toHaveLength(1);
    const rep = result.completedReps[0];

    // Total hold: 1700ms, but ~500ms was frozen → accumulated ~1200ms
    expect(rep.holdMs).toBeGreaterThanOrEqual(1000);
    expect(rep.holdMs).toBeLessThan(1700); // must be less than wall-clock hold time
  });

  it('timer-frozen ticks show isTimerRunning=false during rotation', () => {
    const calFrames = buildCalFrames();

    // Press out
    const pressFrames: Array<{ landmarks: PoseLandmarks; tMs: number }> = [];
    for (let t = 0; t < 700; t += DT) {
      const ratio = t / 700;
      pressFrames.push({
        landmarks: buildPallofPressPose({ elbowExtensionDeg: 90 + ratio * 75 }),
        tMs: CAL_MS + t,
      });
    }

    const holdStart = CAL_MS + 700;
    // Hold with rotation throughout (timer should be frozen)
    const holdFrames = buildFrameRange(
      holdStart, 2000,
      () => buildPallofPressPose({ elbowExtensionDeg: 165, torsoRotationDeg: 12 }),
    );

    // Return
    const returnFrames: Array<{ landmarks: PoseLandmarks; tMs: number }> = [];
    for (let t = 0; t < 700; t += DT) {
      const ratio = t / 700;
      returnFrames.push({
        landmarks: buildPallofPressPose({ elbowExtensionDeg: 165 - ratio * 75 }),
        tMs: holdStart + 2000 + t,
      });
    }

    const result = runLocal([...calFrames, ...pressFrames, ...holdFrames, ...returnFrames]);

    // There should be some frozen ticks after debounce settles
    const frozenTicks = result.holdTicks.filter(t => !t.isTimerRunning);
    expect(frozenTicks.length).toBeGreaterThan(0);
  });
});
