/**
 * Pallof Press — Happy path: 5 clean press cycles.
 * Each cycle: calibration → press out to 160° → hold 1.5s → return to 90°.
 * Asserts: 5 rep-complete events, each hold ≥ 1000ms, no warnings.
 */
import { describe, it, expect } from 'vitest';
import type { PoseLandmarks } from '@/modules/pose/types';
import type { CalibrationUpdate } from '@/modules/squat/types';
import type { WarningType } from '@/store/workout';
import { PallofPressEngine } from '@/modules/pallof-press/engine';
import type { PallofPressRepEvent, PallofPressFrameMetrics } from '@/modules/pallof-press/types';

// ---------------------------------------------------------------------------
// Pose builder — front camera, standing, arms parameterised by elbow angle
// ---------------------------------------------------------------------------

const VIS = 0.95;
const N = 33;

function makeL(x: number, y: number, vis = VIS) {
  return { x, y, z: 0, visibility: vis };
}

function emptyPose(): PoseLandmarks {
  const p: PoseLandmarks = new Array(N).fill(null).map(() => makeL(0.5, 0.5, 0.1));
  return p;
}

/**
 * Build a front-facing standing pose with elbowExtensionDeg controlling arm reach.
 * elbowExtensionDeg: 90 = hands at chest, 180 = fully extended.
 * torsoRotationDeg: simulates shoulder Y asymmetry (0 = square).
 * shoulderShrug: true → shoulders raised above calibration level.
 */
function buildPallofPressPose(opts: {
  elbowExtensionDeg: number;
  torsoRotationDeg?: number;
  shoulderShrug?: boolean;
  distanceOk?: boolean;
}): PoseLandmarks {
  const { elbowExtensionDeg, torsoRotationDeg = 0, shoulderShrug = false, distanceOk = true } = opts;

  const p = emptyPose();

  // Body layout (normalized coords, y increases downward)
  const midX = 0.50;
  const shoulderY = shoulderShrug ? 0.22 : 0.28; // shrug = higher (smaller Y)
  const hipY     = 0.52;
  const kneeY    = 0.70;
  const ankleY   = distanceOk ? 0.88 : 0.35; // far away = small body span
  const noseY    = 0.12;

  const shoulderHalfW = 0.12;
  const hipHalfW      = 0.09;

  // Torso rotation → left shoulder drops (Y increases), right rises, proportional
  const rotRad = (torsoRotationDeg * Math.PI) / 180;
  const rotShift = Math.sin(rotRad) * shoulderHalfW * 0.5;

  const lsY = shoulderY + rotShift;
  const rsY = shoulderY - rotShift;

  // Landmark indices (MediaPipe BlazePose)
  p[0]  = makeL(midX, noseY);           // nose
  p[11] = makeL(midX - shoulderHalfW, lsY); // left shoulder
  p[12] = makeL(midX + shoulderHalfW, rsY); // right shoulder
  p[23] = makeL(midX - hipHalfW, hipY);      // left hip
  p[24] = makeL(midX + hipHalfW, hipY);      // right hip
  p[25] = makeL(midX - hipHalfW, kneeY);     // left knee
  p[26] = makeL(midX + hipHalfW, kneeY);     // right knee
  p[27] = makeL(midX - hipHalfW, ankleY);    // left ankle
  p[28] = makeL(midX + hipHalfW, ankleY);    // right ankle

  // Elbow and wrist: at chest (90°) vs extended (180°).
  // At 90°: elbow is at shoulder X, wrist is at shoulder X (both horizontal, hands in front).
  // The engine computes angle at elbow vertex (shoulder→elbow→wrist).
  // We model this as: at 90°, elbow directly below shoulder; at 180°, arm straight out.
  // In 2D front view: as arms extend forward, the elbow angle approaches 180°.
  // We approximate by adjusting elbow and wrist Y offsets to achieve the target angle.
  const armLen = 0.12; // upper arm length in normalised coords
  const forearmLen = 0.10;

  // Compute elbow position below shoulder (fixed), wrist position varies
  const elbowY = lsY + armLen;
  const re_elbowY = rsY + armLen;

  // Correct geometry: angle at elbow vertex (shoulder→elbow←wrist) = elbowExtensionDeg.
  // Upper arm: from shoulder (same X) down to elbow. (elbow→shoulder) = (0, -1).
  // Forearm: at angle elbowExtensionDeg from upper arm direction.
  // forearmDX = forearmLen * sin((180-deg)*PI/180) — lateral component
  // forearmDY = forearmLen * cos((180-deg)*PI/180) — vertical component (downward)
  const extRad = ((180 - elbowExtensionDeg) * Math.PI) / 180;
  const forearmDX = forearmLen * Math.sin(extRad);  // lateral offset
  const forearmDY = forearmLen * Math.cos(extRad);  // vertical offset (+ = downward)

  const lwY = elbowY + forearmDY;
  const rwY = re_elbowY + forearmDY;

  p[13] = makeL(midX - shoulderHalfW, elbowY);                // left elbow
  p[14] = makeL(midX + shoulderHalfW, re_elbowY);             // right elbow
  p[15] = makeL(midX - shoulderHalfW + forearmDX, lwY);       // left wrist (inward)
  p[16] = makeL(midX + shoulderHalfW - forearmDX, rwY);       // right wrist (inward)

  return p;
}

// ---------------------------------------------------------------------------
// Calibration pose: hands at chest (elbow ~90°), shoulders square
// ---------------------------------------------------------------------------
function buildCalPose(): PoseLandmarks {
  return buildPallofPressPose({ elbowExtensionDeg: 90 });
}

// ---------------------------------------------------------------------------
// Local runner
// ---------------------------------------------------------------------------
interface RunResult {
  calibrationConfirmedAtMs: number | null;
  completedReps: Array<PallofPressRepEvent & { atMs: number }>;
  warnings: Array<{ type: WarningType; atMs: number }>;
  holdTicks: Array<{ accumulatedMs: number; isTimerRunning: boolean; targetMs: number; atMs: number }>;
}

function runLocal(
  frames: Array<{ landmarks: PoseLandmarks | null; tMs: number }>,
): RunResult {
  const completedReps: Array<PallofPressRepEvent & { atMs: number }> = [];
  const warnings: Array<{ type: WarningType; atMs: number }> = [];
  const holdTicks: Array<{ accumulatedMs: number; isTimerRunning: boolean; targetMs: number; atMs: number }> = [];
  let calibrationConfirmedAtMs: number | null = null;
  let currentTMs = 0;

  const engine = new PallofPressEngine({
    onCalibrationUpdate: (u: CalibrationUpdate) => {
      if (u.state === 'confirmed' && calibrationConfirmedAtMs === null) {
        calibrationConfirmedAtMs = currentTMs;
      }
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
// Frame builders
// ---------------------------------------------------------------------------
const FPS = 30;
const DT = 1000 / FPS;
const CAL_MS = 2000; // generous calibration window

function buildCalFrames(): Array<{ landmarks: PoseLandmarks; tMs: number }> {
  const frames = [];
  for (let t = 0; t < CAL_MS; t += DT) {
    frames.push({ landmarks: buildCalPose(), tMs: t });
  }
  return frames;
}

/**
 * One press cycle: press out → hold → return.
 * pressMs: time to reach full extension
 * holdMs: time at full extension
 * returnMs: time to return to chest
 */
function buildRepCycle(
  startMs: number,
  pressMs: number,
  holdMs: number,
  returnMs: number,
  opts: { torsoRotDuringHold?: number } = {},
): Array<{ landmarks: PoseLandmarks; tMs: number }> {
  const frames: Array<{ landmarks: PoseLandmarks; tMs: number }> = [];
  const { torsoRotDuringHold = 0 } = opts;

  // Press out phase: 90° → 165°
  for (let t = 0; t < pressMs; t += DT) {
    const ratio = t / pressMs;
    const deg = 90 + ratio * 75; // 90 → 165
    frames.push({
      landmarks: buildPallofPressPose({ elbowExtensionDeg: deg }),
      tMs: startMs + t,
    });
  }

  // Hold at extension
  for (let t = 0; t < holdMs; t += DT) {
    frames.push({
      landmarks: buildPallofPressPose({
        elbowExtensionDeg: 165,
        torsoRotationDeg: torsoRotDuringHold,
      }),
      tMs: startMs + pressMs + t,
    });
  }

  // Return phase: 165° → 90°
  for (let t = 0; t < returnMs; t += DT) {
    const ratio = t / returnMs;
    const deg = 165 - ratio * 75; // 165 → 90
    frames.push({
      landmarks: buildPallofPressPose({ elbowExtensionDeg: deg }),
      tMs: startMs + pressMs + holdMs + t,
    });
  }

  return frames;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('Pallof Press — happy path', () => {
  it('calibrates and completes 5 clean reps with no warnings', () => {
    const calFrames = buildCalFrames();
    const allFrames = [...calFrames];

    const cycleTotal = 700 + 1500 + 700; // 2900ms each cycle
    for (let i = 0; i < 5; i++) {
      const start = CAL_MS + i * cycleTotal;
      const cycle = buildRepCycle(start, 700, 1500, 700);
      allFrames.push(...cycle);
    }

    const result = runLocal(allFrames);

    expect(result.calibrationConfirmedAtMs).not.toBeNull();
    expect(result.calibrationConfirmedAtMs).toBeLessThanOrEqual(CAL_MS + 50);

    expect(result.completedReps).toHaveLength(5);

    // Each rep must have held ≥ 1000ms
    for (const rep of result.completedReps) {
      expect(rep.holdMs).toBeGreaterThanOrEqual(1000);
    }

    // No posture warnings during clean reps
    const nonPositionLost = result.warnings.filter(w => w.type !== 'position-lost');
    expect(nonPositionLost).toHaveLength(0);
  });

  it('emits onHoldTick callbacks during AT_EXTENDED phase', () => {
    const calFrames = buildCalFrames();
    const cycle = buildRepCycle(CAL_MS, 700, 1500, 700);

    const result = runLocal([...calFrames, ...cycle]);

    // Should have at least some hold ticks from the 1.5s hold phase
    expect(result.holdTicks.length).toBeGreaterThan(0);

    // targetMs should match MIN_HOLD_MS_PER_REP = 1000
    for (const tick of result.holdTicks) {
      expect(tick.targetMs).toBe(1000);
    }
  });

  it('each completed rep has mqs > 0', () => {
    const calFrames = buildCalFrames();
    const allFrames = [...calFrames];

    const cycleTotal = 700 + 1500 + 700;
    for (let i = 0; i < 3; i++) {
      const start = CAL_MS + i * cycleTotal;
      allFrames.push(...buildRepCycle(start, 700, 1500, 700));
    }

    const result = runLocal(allFrames);
    expect(result.completedReps).toHaveLength(3);
    for (const rep of result.completedReps) {
      expect(rep.mqs).toBeGreaterThan(0);
      expect(rep.mqs).toBeLessThanOrEqual(100);
    }
  });
});
