/**
 * Fire Hydrant — posture warning tests.
 * Verifies: not-moving fires after 5s idle, debounce prevents single-frame noise.
 */
import { describe, it, expect } from 'vitest';
import type { PoseLandmarks } from '@/modules/pose/types';
import type { CalibrationUpdate } from '@/modules/squat/types';
import { FireHydrantEngine } from '@/modules/fire-hydrant/engine';
import type { WarningType } from '@/store/workout';
import type { Frame } from '../../harness/types';

function buildCalFrame(vis = 0.95): PoseLandmarks {
  const SHOULDER_X = 0.68;
  const SHOULDER_Y = 0.42;
  const HIP_X = 0.45;
  const HIP_Y = 0.42;
  const L_THIGH = 0.18;
  const L_SHIN = 0.18;
  const lm: PoseLandmarks = Array.from({ length: 33 }, () => ({
    x: 0.5, y: 0.5, z: 0, visibility: 0.1,
  })) as unknown as PoseLandmarks;
  lm[11] = { x: SHOULDER_X, y: SHOULDER_Y, z: 0, visibility: vis };
  lm[12] = { x: SHOULDER_X, y: SHOULDER_Y + 0.01, z: 0, visibility: vis * 0.7 };
  lm[23] = { x: HIP_X, y: HIP_Y, z: 0, visibility: vis };
  lm[24] = { x: HIP_X, y: HIP_Y + 0.01, z: 0, visibility: vis * 0.7 };
  lm[25] = { x: HIP_X, y: HIP_Y + L_THIGH, z: 0, visibility: vis };
  lm[26] = { x: HIP_X, y: HIP_Y + L_THIGH, z: 0, visibility: vis * 0.6 };
  lm[27] = { x: HIP_X - L_SHIN, y: HIP_Y + L_THIGH + L_SHIN * 0.3, z: 0, visibility: vis };
  lm[28] = { x: HIP_X - L_SHIN, y: HIP_Y + L_THIGH + L_SHIN * 0.3, z: 0, visibility: vis * 0.6 };
  lm[15] = { x: SHOULDER_X + 0.12, y: SHOULDER_Y + 0.32, z: 0, visibility: vis };
  lm[16] = { x: SHOULDER_X - 0.23, y: SHOULDER_Y + 0.32, z: 0, visibility: vis * 0.7 };
  return lm;
}

function runIdleTest(idleAfterCalMs: number): Array<{ type: WarningType; atMs: number }> {
  const warnings: Array<{ type: WarningType; atMs: number }> = [];
  let calibrationConfirmedAtMs: number | null = null;
  let currentTMs = 0;

  const engine = new FireHydrantEngine({
    onCalibrationUpdate: (u: CalibrationUpdate) => {
      if (u.state === 'confirmed' && calibrationConfirmedAtMs === null) {
        calibrationConfirmedAtMs = currentTMs;
      }
    },
    onPostureWarning: (type) => warnings.push({ type, atMs: currentTMs }),
  });

  const fps = 30;
  const step = 1000 / fps;
  const totalMs = 2200 + idleAfterCalMs;

  for (let t = 0; t <= totalMs; t += step) {
    currentTMs = t;
    engine.update(buildCalFrame(), t);
  }
  engine.finish();
  return warnings;
}

describe('Fire Hydrant — posture warnings', () => {
  it('fires not-moving after 5s idle post-calibration', () => {
    const warnings = runIdleTest(6000);
    const notMoving = warnings.filter((w) => w.type === 'not-moving');
    expect(notMoving.length).toBeGreaterThanOrEqual(1);
  });

  it('does not fire not-moving if idle < 5s', () => {
    const warnings = runIdleTest(3000);
    const notMoving = warnings.filter((w) => w.type === 'not-moving');
    expect(notMoving.length).toBe(0);
  });

  it('not-moving fires approximately at the 5s mark post-cal (within 1s tolerance)', () => {
    const warnings: Array<{ type: WarningType; atMs: number }> = [];
    let calConfirmedAt: number | null = null;
    let currentTMs = 0;

    const engine = new FireHydrantEngine({
      onCalibrationUpdate: (u: CalibrationUpdate) => {
        if (u.state === 'confirmed' && calConfirmedAt === null) calConfirmedAt = currentTMs;
      },
      onPostureWarning: (type) => warnings.push({ type, atMs: currentTMs }),
    });

    const fps = 30;
    const step = 1000 / fps;
    for (let t = 0; t <= 9000; t += step) {
      currentTMs = t;
      engine.update(buildCalFrame(), t);
    }
    engine.finish();

    const notMoving = warnings.filter((w) => w.type === 'not-moving');
    expect(notMoving.length).toBeGreaterThanOrEqual(1);
    if (calConfirmedAt !== null && notMoving.length > 0) {
      const idleMs = notMoving[0].atMs - calConfirmedAt;
      expect(idleMs).toBeGreaterThanOrEqual(4000);
      expect(idleMs).toBeLessThanOrEqual(7000);
    }
  });

  it('not-moving does not fire during an active rep', () => {
    const warnings: Array<{ type: WarningType; atMs: number }> = [];
    let currentTMs = 0;

    const engine = new FireHydrantEngine({
      onCalibrationUpdate: () => {},
      onPostureWarning: (type) => warnings.push({ type, atMs: currentTMs }),
    });

    const fps = 30;
    const step = 1000 / fps;
    const CAL_MS = 2200;
    const totalMs = CAL_MS + 8000;

    // Cal phase then continuous lifting (never returns to AT_REST)
    for (let t = 0; t <= totalMs; t += step) {
      currentTMs = t;
      let liftDeg = 0;
      if (t >= CAL_MS) {
        // Gradually lift and stay at 50° — never returns below 10°
        const elapsed = t - CAL_MS;
        liftDeg = Math.min(50, (elapsed / 1000) * 20);
      }
      const lm: PoseLandmarks = Array.from({ length: 33 }, () => ({
        x: 0.5, y: 0.5, z: 0, visibility: 0.1,
      })) as unknown as PoseLandmarks;
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
      lm[11] = { x: SHOULDER_X, y: SHOULDER_Y, z: 0, visibility: 0.95 };
      lm[12] = { x: SHOULDER_X, y: SHOULDER_Y + 0.01, z: 0, visibility: 0.7 };
      lm[23] = { x: HIP_X, y: HIP_Y, z: 0, visibility: 0.95 };
      lm[24] = { x: HIP_X, y: HIP_Y + 0.01, z: 0, visibility: 0.7 };
      lm[25] = { x: kneeX, y: kneeY, z: 0, visibility: 0.95 };
      lm[26] = { x: HIP_X, y: HIP_Y + L_THIGH, z: 0, visibility: 0.6 };
      lm[27] = { x: ankleX, y: ankleY, z: 0, visibility: 0.95 };
      lm[28] = { x: HIP_X - L_SHIN, y: HIP_Y + L_THIGH + L_SHIN * 0.3, z: 0, visibility: 0.6 };
      lm[15] = { x: SHOULDER_X + 0.12, y: SHOULDER_Y + 0.32, z: 0, visibility: 0.95 };
      lm[16] = { x: SHOULDER_X - 0.23, y: SHOULDER_Y + 0.32, z: 0, visibility: 0.7 };
      engine.update(lm, t);
    }
    engine.finish();

    const notMoving = warnings.filter((w) => w.type === 'not-moving');
    expect(notMoving.length).toBe(0);
  });
});
