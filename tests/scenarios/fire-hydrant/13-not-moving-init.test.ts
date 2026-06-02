/**
 * Fire Hydrant — Fix I + Fix P: not-moving idle detection init regression.
 *
 * Two regressions from rounds 5-7:
 * 1. (Fix I) idle tracker must be initialized ON CAL CONFIRM, not at engine
 *    construction — otherwise standingSince=0 causes instant false positive.
 * 2. (Fix P) cold-start cooldown: lastNoMovementWarnAt=0 initially. If now < 15s
 *    at first potential fire, the cooldown would block it. Must allow first fire.
 */
import { describe, it, expect } from 'vitest';
import type { PoseLandmarks } from '@/modules/pose/types';
import type { CalibrationUpdate } from '@/modules/squat/types';
import { FireHydrantEngine } from '@/modules/fire-hydrant/engine';
import type { WarningType } from '@/store/workout';

function buildRestPose(vis = 0.95): PoseLandmarks {
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

describe('Fire Hydrant — not-moving init (Fix I + Fix P)', () => {
  it('does NOT fire not-moving before calibration confirms', () => {
    const warnings: Array<{ type: WarningType; atMs: number }> = [];
    let currentTMs = 0;

    const engine = new FireHydrantEngine({
      onCalibrationUpdate: () => {},
      onPostureWarning: (type) => warnings.push({ type, atMs: currentTMs }),
    });

    // Feed 10 seconds of rest BEFORE calibration confirms
    const fps = 30;
    const step = 1000 / fps;
    for (let t = 0; t <= 10000; t += step) {
      currentTMs = t;
      // Intentionally pass bad landmarks (no visible body) so cal never confirms
      const nullPose: PoseLandmarks = Array.from({ length: 33 }, () => ({
        x: 0.5, y: 0.5, z: 0, visibility: 0.0,
      })) as unknown as PoseLandmarks;
      engine.update(nullPose, t);
    }
    engine.finish();

    const notMoving = warnings.filter((w) => w.type === 'not-moving');
    expect(notMoving.length).toBe(0);
  });

  it('fires not-moving 5s after calibration confirms (cold-start cooldown works)', () => {
    const warnings: Array<{ type: WarningType; atMs: number }> = [];
    let calConfirmedAt: number | null = null;
    let currentTMs = 0;

    const engine = new FireHydrantEngine({
      onCalibrationUpdate: (u: CalibrationUpdate) => {
        if (u.state === 'confirmed' && calConfirmedAt === null) {
          calConfirmedAt = currentTMs;
        }
      },
      onPostureWarning: (type) => warnings.push({ type, atMs: currentTMs }),
    });

    const fps = 30;
    const step = 1000 / fps;
    // Cal phase + 7s idle
    for (let t = 0; t <= 2200 + 7000; t += step) {
      currentTMs = t;
      engine.update(buildRestPose(), t);
    }
    engine.finish();

    expect(calConfirmedAt).not.toBeNull();
    const notMoving = warnings.filter((w) => w.type === 'not-moving');
    expect(notMoving.length).toBeGreaterThanOrEqual(1);

    // Should fire approximately 5s after cal confirmed
    if (calConfirmedAt !== null && notMoving.length > 0) {
      const delay = notMoving[0].atMs - calConfirmedAt;
      expect(delay).toBeGreaterThanOrEqual(4000);
      expect(delay).toBeLessThanOrEqual(7000);
    }
  });
});
